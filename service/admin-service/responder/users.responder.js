require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { saveLoginLog, sendmail } = require('@libs/common/common-util');
const APP_CONFIG = require('@libs/config/config.prod');
const { getAllSettingsCategory } = require('@libs/common/common-util');
const commonenum = require('@libs/config/enum');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'admin-users responder',
    key: 'admin-users',
    redis: { host: redisHost, port: redisPort }
});

// ================================================================
// Generate next user code
// ================================================================
async function generateNextUserCode(pool) {
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM prefix_refno
     WHERE table_name='users' AND is_active = true AND is_deleted = false
     ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = prefixRes.rows[0]?.prefix_code || "USR";

    const result = await pool.query(
        `SELECT user_code FROM users
     WHERE user_code IS NOT NULL 
     ORDER BY (regexp_replace(user_code,'\\D','','g'))::int DESC
     LIMIT 1`
    );
    const lastCode = result.rows[0]?.user_code || null;

    if (!lastCode) return `${prefix}00001`;
    const match = lastCode.match(/\d+$/);
    const number = match ? parseInt(match[0], 10) : 0;
    return `${prefix}${(number + 1).toString().padStart(5, "0")}`;
}

// --------------------------------------------------
// LOGIN API
// --------------------------------------------------

responder.on("admin-login", async (req, cb) => {
    try {
        const { username, password, device_detail, browser_used } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!username?.trim()) {
            return cb(null, { status: false, code: 2001, error: "Username is required" });
        }
        if (!password?.trim()) {
            return cb(null, { status: false, code: 2001, error: "Password is required" });
        }

        const usernameTrim = username.trim();

        // -----------------------------
        // FIND USER
        // -----------------------------
        const query = {
            text: `
                SELECT 
                u.user_id,u.is_online,
                u.user_uuid,
                u.username,
                u.email,
                u.phone_number,
                u.password_hash,
                u.is_active,

                ul.login_id
                FROM users u
                LEFT JOIN users_login ul
                ON ul.user_id = u.user_id
                WHERE
                u.username = $1 AND u.is_deleted = FALSE
            `,
            values: [usernameTrim]
        };

        const result = await pool.query(query);
        console.log("result", result);

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "User not found" });
        }

        const user = result.rows[0];

        if (user.is_online) {
            return cb(null, {
                status: false,
                code: 2002,
                error: "User already logged in"
            });
        }

        // -----------------------------
        // PASSWORD CHECK
        // -----------------------------
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return cb(null, { status: false, code: 2001, error: "Invalid password" });
        }

        // -------------------------
        // Update users table → Online Status
        // -------------------------
        const userUpdateQuery = `
        UPDATE users
        SET is_online = true WHERE user_id = $1 AND is_deleted = false`;

        await pool.query(userUpdateQuery, [user.user_id]);

        // Log login details
        const loginDetails = await saveLoginLog({
            user_id: user.user_id,
            portal_user_id: null,
            device_detail: device_detail,
            browser_used: browser_used,
            created_by: user.user_uuid
        });

        // ADD LOGINID IN OBJECT
        user.login_id = loginDetails.data.login_id

        // -----------------------------------------
        // CHECK ACTIVE ACCESS TOKEN
        // -----------------------------------------
        const sessionCheck = await pool.query(
            `SELECT * FROM user_access_tokens 
             WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1`,
            [user.user_id]
        );

        let finalAccessToken = null;
        let finalRefreshToken = null;

        console.log("sessionCheck", sessionCheck.rowCount);


        if (sessionCheck.rowCount > 0) {
            const lastSession = sessionCheck.rows[0];
            const existingAccessToken = lastSession.access_token;

            try {
                // If token is valid → reuse same token
                jwt.verify(existingAccessToken, 'a4db08b7-5729-4ba9-8c08-f2df493465a1');
                finalAccessToken = existingAccessToken;
            } catch (err) {
                // Token expired → generate new one
                const newTokens = generateTokens(user);
                finalAccessToken = newTokens.accessToken;
                finalRefreshToken = newTokens.refreshToken;
            }
        } else {
            // No session → generate new tokens
            const newTokens = generateTokens(user);
            finalAccessToken = newTokens.accessToken;
            finalRefreshToken = newTokens.refreshToken;
        }

        // If new refresh token is created, store it
        if (finalRefreshToken) {
            const tokenData = await storeUserToken(user, finalRefreshToken);
            await storeAccessToken(user, finalAccessToken, tokenData.user_token_id);
        }

        // -----------------------------------------
        // CREATE / UPDATE SESSION
        // -----------------------------------------
        await createUserSession(
            loginDetails.data.login_id,
            user.user_uuid,
            finalAccessToken,
            device_detail || browser_used || "login"
        );

        delete user.password_hash;

        return cb(null, {
            status: true,
            code: 1000,
            message: "Login successful",
            data: {
                ...user,
                accessToken: finalAccessToken
            }
        });

    } catch (err) {
        logger.error("Responder Error (login):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});

// --------------------------------------------------
// Store User Token (with expiry check)
// --------------------------------------------------
async function storeUserToken(user, refreshToken) {
    try {
        // 1. Check for existing active & non-expired token
        const existingToken = await pool.query(
            `
            SELECT user_token_id, expires_at
            FROM user_tokens
            WHERE user_id = $1
              AND is_active = true
              AND expires_at > NOW()
            LIMIT 1
            `,
            [user.user_id]
        );

        // 2. If valid token already exists, no need to insert
        if (existingToken.rows.length > 0) {
            return existingToken.rows[0];
        }

        // 3. Deactivate any old active tokens (expired or not)
        await pool.query(
            `
            UPDATE user_tokens
            SET is_active = false,
                modified_by = $1,
                modified_at = NOW()
            WHERE user_id = $2
              AND is_active = true
            `,
            [user.user_uuid, user.user_id]
        );

        // 4. Insert new token
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

        const result = await pool.query(
            `
            INSERT INTO user_tokens
            (user_id, refresh_token, is_active, expires_at, created_by, created_at)
            VALUES ($1, $2, true, $3, $4, NOW())
            RETURNING user_token_id
            `,
            [user.user_id, refreshToken, expiresAt, user.user_uuid]
        );

        return result.rows[0];

    } catch (err) {
        console.error("storeUserToken error:", err);
        throw err;
    }
}

// --------------------------------------------------
// Store Access Token
// --------------------------------------------------
async function storeAccessToken(user, accessToken, user_token_id) {
    try {
        await pool.query(
            `UPDATE user_access_tokens
             SET is_active = false, modified_by = $1, modified_at = NOW()
             WHERE user_id = $2 AND is_active = true`,
            [user.user_uuid, user.user_id]
        );

        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

        await pool.query(
            `INSERT INTO user_access_tokens
             (user_id, access_token, is_active, expires_at, created_by, created_at, user_token_id)
             VALUES ($1, $2, true, $3, $4, NOW(), $5)`,
            [user.user_id, accessToken, expiresAt, user.user_uuid, user_token_id]
        );

    } catch (err) {
        console.error("storeAccessToken error:", err);
        throw err;
    }
}

// --------------------------------------------------
// Create User Session
// --------------------------------------------------
async function createUserSession(login_id, user_uuid, accessToken, device_detail) {
    try {
        // Close previous active sessions
        await pool.query(
            `UPDATE user_session
             SET is_active = false, end_date = NOW()
             WHERE login_id = $1 AND is_active = true`,
            [login_id]
        );

        await pool.query(
            `INSERT INTO user_session
             (login_id, device_detail, is_active, created_by, created_at, access_token)
             VALUES ($1, $2, true, $3, NOW(), $4)`,
            [login_id, device_detail, user_uuid, accessToken]
        );

    } catch (err) {
        console.error("createUserSession error:", err);
        throw err;
    }
}

// --------------------------------------------------
// Generate JWT tokens
// --------------------------------------------------
function generateTokens(user) {
    let jwtKeyValue = null;
    let accessTokenExpiry = null;
    let refreshTokenExpiry = null;

    (async () => {
        try {
            const arr = await getAllSettingsCategory('JWT');
            console.log("arr", arr);

            const jwtKey = arr?.find(e => e.setparameter === "JWT_KEY");
            jwtKeyValue = jwtKey?.setparametervalue || null;

            const accessExp = arr?.find(e => e.setparameter === "ACCESS_TOKEN_EXPIRES_IN");
            accessTokenExpiry = accessExp?.setparametervalue || null;

            const refreshExp = arr?.find(e => e.setparameter === "REFRESH_TOKEN_EXPIRES_IN");
            refreshTokenExpiry = refreshExp?.setparametervalue || null;

        } catch (err) {
            console.error("JWT Settings Load Failed:", err);
        }
    })();


    const accessToken = jwt.sign(
        { user_id: user.user_id, user_uuid: user.user_uuid, username: user.username, login_id: user.login_id },
        jwtKeyValue,
        { expiresIn: accessTokenExpiry }
    );

    const refreshToken = jwt.sign(
        { user_id: user.user_id },
        jwtKeyValue,
        { expiresIn: refreshTokenExpiry }
    );

    console.log("refreshToken", refreshToken);
    return { accessToken, refreshToken };
}

// --------------------------------------------------
// LOGOUT USER
// --------------------------------------------------
responder.on("logout", async (req, cb) => {
    const { user_id, access_token, } = req.body;
    const updated_by = req.body.user_uuid;

    try {
        if (!user_id || !access_token) {
            return cb(null, { status: false, code: 2001, error: "Missing required fields" });
        }

        // 1. Check Users Login Details
        const checkUser = await pool.query(
            `SELECT login_uuid,user_id, login_id FROM users_login 
             WHERE user_id = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [user_id]
        );

        if (checkUser.rowCount === 0) {
            return cb(null, { status: false, error: "User not found" });
        }

        const user = checkUser.rows[0];

        // -------------------------
        // Close session
        // -------------------------
        const sessionQuery = `
            UPDATE user_session
            SET
                end_date = NOW(),
                is_active = false,
                modified_by = $3,
                modified_at = NOW()
            WHERE login_id = $1
              AND access_token = $2
              AND is_active = true
            RETURNING user_session_id;
        `;

        const session = await pool.query(sessionQuery, [user.login_id, access_token, updated_by]);

        if (session.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Active session not found" });
        }

        // -------------------------
        // Update users table → Offline
        // -------------------------
        const userUpdateQuery = `
            UPDATE users
            SET 
                is_online = false,
                force_logout = false,
                modified_at = NOW(),
                modified_by = $2
            WHERE user_id = $1
              AND is_deleted = false
        `;

        await pool.query(userUpdateQuery, [user_id, updated_by]);

        // Update last active login row
        await pool.query(
            `UPDATE users_login
                 SET logout_time = NOW(), is_active = false
                 WHERE user_id = $1 AND is_active = true`,
            [user_id]
        );

        // -------------------------
        // Success
        // -------------------------
        return cb(null, {
            status: true, code: 1000,
            message: "Logout successful",
        });

    } catch (err) {
        return cb(null, {
            status: false,
            code: 2004,
            error: "Internal server error"
        });
    }
});


responder.on('get-next-prefix-refno', async (req, cb) => {
    try {
        const { category_type } = req;

        // 1. Get config from prefix_refno table
        const configResult = await pool.query(
            `SELECT table_name, id_field, ref_field, prefix_code
       FROM prefix_refno
       WHERE category_type = $1
         AND is_active = TRUE`,
            [category_type]
        );

        if (configResult.rowCount === 0) {
            return cb(null, {
                status: false,
                code: 2003,
                error: 'Invalid category type'
            });
        }

        const { table_name, id_field, ref_field, prefix_code } = configResult.rows[0];

        // 2. Get last reference number
        const lastRefResult = await pool.query(
            `SELECT ${ref_field}
       FROM ${table_name}
       ORDER BY ${id_field} DESC
       LIMIT 1`
        );

        // 3. Date parts
        const now = new Date();
        const yy = now.getFullYear().toString().slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');

        let nextRefNo;

        if (lastRefResult.rowCount === 0 || !lastRefResult.rows[0][ref_field]) {
            nextRefNo = `${prefix_code}${yy}${mm}${dd}1`;
        } else {
            const lastRef = lastRefResult.rows[0][ref_field];
            const fixedLen = prefix_code.length + yy.length + mm.length + dd.length;
            const lastSeq = parseInt(lastRef.substring(fixedLen)) || 0;
            nextRefNo = `${prefix_code}${yy}${mm}${dd}${lastSeq + 1}`;
        }

        return cb(null, {
            status: true,
            code: 1000,
            data: {
                category_type,
                [ref_field]: nextRefNo
            }
        });

    } catch (err) {
        logger.error("Responder Error (get-next-prefix-refno):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});

// --------------------------------------------------
// CLONE USER
// --------------------------------------------------
responder.on('clone-users', async (req, cb) => {
    try {
        const { user_uuid } = req;
        const { created_by } = req.body;  // user performing clone

        if (!user_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "User UUID is required"
            });
        }

        // 1. Fetch existing user
        const fetchSQL = `
            SELECT 
                username, email, phone_number, role_id, profile_icon,
                is_active
            FROM users
            WHERE user_uuid = $1 AND is_deleted = FALSE;
        `;

        const fetchResult = await pool.query(fetchSQL, [user_uuid]);

        if (fetchResult.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Original user not found" });
        }

        const user = fetchResult.rows[0];
        const password_hash = await bcrypt.hash("Password123", 10);
        // 2. Insert cloned user
        const cloneSQL = `
    INSERT INTO users 
    (username, password_hash, email, phone_number, role_id, profile_icon,
     is_online, force_logout, is_active,
     created_by, created_at)
    VALUES 
    ($1, $2, $3, $4, $5, $6,
     FALSE, FALSE, $7,
     $8, NOW())
    RETURNING user_id, user_uuid, username, email, phone_number, role_id, is_active;
`;


        const cloneValues = [
            user.username + " (Copy)",  // $1 username
            password_hash,              // $2 password_hash
            null,                       // $3 email (not cloned)
            null,                       // $4 phone_number (not cloned)
            user.role_id,               // $5 role_id
            user.profile_icon,          // $6 profile_icon
            user.is_active,             // $7 is_active
            created_by || null          // $8 created_by
        ];


        const cloneResult = await pool.query(cloneSQL, cloneValues);

        return cb(null, {
            status: true, code: 1000,
            message: "User cloned successfully",
            data: cloneResult.rows[0]
        });

    } catch (err) {
        console.error("clone-users error:", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});



// --------------------------------------------------
// CREATE USER
// --------------------------------------------------


responder.on('create-users', async (req, cb) => {
    try {
        const {
            username, fullname,
            email,
            password,
            user_type_uuid,
            phone_number,
            role_uuid,
            profile_icon,
            created_by, reporting_to
        } = req.body;

        // --------------------------------------------------
        // VALIDATION
        // --------------------------------------------------
        if (!username?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Username is required"
            });
        }
        if (!password?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Password is required"
            });
        }

        const roleResult = await pool.query(
            `SELECT role_id FROM user_role 
             WHERE role_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            [role_uuid]
        );

        if (roleResult.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Role not found"
            });
        }

        const role_id = roleResult.rows[0].role_id;
        const userTypeResult = await pool.query(
            `SELECT user_type_id FROM user_types 
             WHERE user_type_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            [user_type_uuid]
        );

        if (userTypeResult.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "User type not found"
            });
        }

        const user_type_id = userTypeResult.rows[0].user_type_id;

        // --------------------------------------------------
        // DUPLICATE CHECK (username / email / phone)
        // --------------------------------------------------
        const usernameTrim = username.trim();
        const usernameUpper = usernameTrim.toUpperCase();
        const usernameLower = usernameTrim.toLowerCase();

        const duplicateQuery = {
            text: `
                SELECT user_id 
                FROM users 
                WHERE 
                (
                    username = $1
                    OR LOWER(username) = $2
                    OR UPPER(username) = $3
                    OR LOWER(email) = LOWER($4)
                    OR phone_number = $5
                )
                AND is_deleted = FALSE
                AND is_active = TRUE
            `,
            values: [
                usernameTrim,
                usernameLower,
                usernameUpper,
                email.trim(),
                phone_number
            ]
        };

        const duplicateCheck = await pool.query(duplicateQuery);

        if (duplicateCheck.rowCount > 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Creation failed",
                error: "User already exists (username/email/phone)"
            });
        }

        // --------------------------------------------------
        // AUTO-GENERATE USER CODE
        // --------------------------------------------------
        const user_code = await generateNextUserCode(pool);

        // --------------------------------------------------
        // HASH PASSWORD
        // --------------------------------------------------
        const password_hash = await bcrypt.hash(password, 10);

        // --------------------------------------------------
        // INSERT USER
        // --------------------------------------------------
        const insertQuery = {
            text: `
                INSERT INTO users 
                    (user_code, username, fullname, email, password_hash, user_type_id, phone_number, role_id, reporting_to, created_by, assigned_to, profile_icon)
                VALUES 
                    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING 
                    user_id, user_uuid, user_code, username, email, phone_number, role_id, user_type_id, is_active
            `,
            values: [
                user_code,
                usernameTrim,
                fullname,
                email,
                password_hash,
                user_type_id,
                phone_number,
                role_id,
                reporting_to,
                created_by,
                created_by,
                profile_icon
            ]
        };

        const insert = await pool.query(insertQuery);

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "User created successfully",
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (create user):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});

// --------------------------------------------------
// LIST USERS
// --------------------------------------------------

responder.on('list-users', async (req, cb) => {
    try {
        const query = {
            text: `
                SELECT 
                    u.user_id,
                    u.user_uuid,
                    u.username,
                    u.fullname,
                    u.email,
                    u.phone_number,
                    u.user_type_id,
                    u.reporting_to,
                    u.profile_icon,
                    u.is_online,
                    u.force_logout,
                    u.last_login,
                    u.is_active,
                    u.created_at,
                    u.created_by,
                    u.modified_at,
                    u.modified_by,
                    u.deleted_at,
                    u.deleted_by,
                    u.is_deleted,
                    
                    -- Created & Updated Usernames
                    creators.username AS createdByName,
                    updaters.username AS updatedByName,

                    -- Role Info
                    r.role_name,
                    r.role_uuid,
                    t.name AS usertype_name
                FROM users u
                LEFT JOIN users creators 
                    ON u.created_by = creators.user_uuid
                LEFT JOIN users updaters 
                    ON u.modified_by = updaters.user_uuid
                LEFT JOIN user_role r
                    ON u.role_id = r.role_id
                LEFT JOIN user_types t
                    ON u.user_type_id = t.user_type_id
                WHERE 
                    u.is_deleted = FALSE 
                    AND u.is_active = TRUE
                    AND u.role_id != $1          -- ← EXCLUDE SUPER ADMIN
                ORDER BY 
                    u.created_at ASC
            `,
            values: [
                commonenum.ROLE_ID.SUPER_ADMIN
            ]
        };

        const result = await pool.query(query);

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Users list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("Responder Error (list users):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});

// --------------------------------------------------
// UPDATE USER
// --------------------------------------------------


// responder.on('update-users', async (req, cb) => {
//     const client = await pool.connect();

//     try {
//         await client.query('BEGIN');

//         const { user_uuid } = req;
//         const {
//             username, fullname, password, user_code,
//             email,
//             phone_number, user_type_uuid,
//             role_uuid,
//             profile_icon,
//             modified_by, reporting_to, is_active,
//         } = req.body;

//         if (!user_uuid) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2001,
//                 message: "Validation failed",
//                 error: "User UUID is required"
//             });
//         }

//         if (!username || !username.trim()) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2001,
//                 message: "Validation failed",
//                 error: "Username is required"
//             });
//         }

//         const usernameTrim = username.trim();

//         /* ======================================================
//            CHECK EDIT LOCK 
//         ====================================================== */
//         const lockCheck = await client.query(
//             `
//             SELECT 1
//             FROM record_locks
//             WHERE table_name = 'users'
//               AND record_id = $1
//               AND locked_by = $2
//               AND is_deleted = FALSE
//               AND expires_at > NOW()
//             `,
//             [user_uuid, modified_by]
//         );

//         if (lockCheck.rowCount === 0) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2005,
//                 message: "Update failed",
//                 error: "You must lock the record before updating"
//             });
//         }


//         const roleResult = await client.query(
//             `SELECT role_id FROM user_role 
//              WHERE role_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
//             [role_uuid]
//         );

//         if (roleResult.rowCount === 0) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2003,
//                 message: "Record not found",
//                 error: "Role not found"
//             });
//         }

//         const role_id = roleResult.rows[0].role_id;


//         const userTypeResult = await client.query(
//             `SELECT user_type_id FROM user_types 
//              WHERE user_type_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
//             [user_type_uuid]
//         );

//         if (userTypeResult.rowCount === 0) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2003,
//                 message: "Record not found",
//                 error: "User type not found"
//             });
//         }

//         const user_type_id = userTypeResult.rows[0].user_type_id;

//         // --------------------------------------------------
//         // CHECK DUPLICATE 
//         // --------------------------------------------------
//         const duplicate = await client.query(
//             `
//             SELECT user_id 
//             FROM users 
//             WHERE 
//             (
//                 LOWER(username) = LOWER($1)
//                 OR LOWER(email) = LOWER($2)
//                 OR phone_number = $3
//             )
//             AND is_deleted = FALSE
//             AND is_active = TRUE
//             AND user_uuid != $4
//             `,
//             [usernameTrim, email.trim(), phone_number, user_uuid]
//         );




//         if (duplicate.rowCount > 0) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2002,
//                 message: "Updation failed",
//                 error: "Username, email or phone number already exists"
//             });
//         }

//         // ---------- USER CODE UNIQUENESS CHECK ----------
//         if (user_code) {
//             const existingCode = await pool.query(
//                 `SELECT 1 FROM users 
//                  WHERE user_code = $1 
//                    AND user_uuid <> $2`,
//                 [user_code, user_uuid]
//             );

//             if (existingCode.rows.length > 0) {
//                 return cb(null, {
//                     header_type: "ERROR",
//                     message_visibility: true,
//                     status: false,
//                     code: 2001,
//                     message: "Validation failed",
//                     error: "User code already exists"
//                 });
//             }
//         }


// // ---------- USER CODE GAP CHECK ----------
// // Get the max existing user code number
// if (user_code) {
// const result = await pool.query(
//     `SELECT MAX((regexp_replace(user_code, '\\D', '', 'g'))::int) AS max_num
//      FROM users
//      WHERE user_code IS NOT NULL AND is_deleted = false`
// );
// const maxNum = result.rows[0]?.max_num ?? 0;
// const expectedNext = maxNum + 1;
// // Extract number from submitted code
// const submittedNum = parseInt(user_code.replace(/\D/g, ""), 10);
// if (submittedNum !== expectedNext) {
//     const prefix = user_code.replace(/\d+$/, "");
//     const expectedCode = `${prefix}${String(expectedNext).padStart(5, "0")}`;
//     return cb(null, {
//         header_type: "ERROR",
//         message_visibility: true,
//         status: false,
//         code: 2001,
//         message: "Validation failed",
//         error: `User code is not allowed. Next expected code is "${expectedCode}".`
//     });
// }
// }
//         // -----------------------------
//         // CHECK USER EXISTS
//         // -----------------------------
//         const exists = await client.query(
//             `SELECT profile_icon,password_hash,user_code FROM users
//              WHERE user_uuid = $1 AND is_deleted = FALSE`,
//             [user_uuid]
//         );

//         if (exists.rowCount === 0) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2003,
//                 message: "Record not found",
//                 error: "User not found"
//             });
//         }

//         const existingPath = exists.rows[0].profile_icon;
//         const existingPassword = exists.rows[0].password_hash;
//         const existingUserCode= exists.rows[0].user_code;

//         // --------------------------------------------------
//         // HASH PASSWORD (only if new password is provided)
//         // --------------------------------------------------
//         const password_hash = password
//             ? await bcrypt.hash(password, 10)
//             : existingPassword;

//         // --------------------------------------------------
//         // UPDATE USER
//         // --------------------------------------------------
//         const update = await client.query(
//             `
//             UPDATE users
//             SET 
//                 username = $1,
//                 email = $2,
//                 phone_number = $3,
//                 role_id = $4,
//                 modified_by = $5,
//                 modified_at = NOW(),
//                 fullname = $7,
//                 reporting_to = $8,
//                 is_active = $9,
//                 profile_icon = $10,
//                 user_type_id = $11,
//                 password_hash = $12,
//                 user_code = $13
//             WHERE user_uuid = $6
//             RETURNING *
//             `,
//             [
//                 usernameTrim,
//                 email,
//                 phone_number,
//                 role_id,
//                 modified_by,
//                 user_uuid,
//                 fullname,
//                 reporting_to,
//                 is_active,
//                 profile_icon || existingPath,
//                 user_type_id,
//                 password_hash || existingPassword,
//                 user_code || existingUserCode
//             ]
//         );

//         /* ======================================================
//            AUTO-UNLOCK AFTER SUCCESS
//         ====================================================== */
//         await client.query(
//             `
//             UPDATE record_locks
//             SET is_deleted = TRUE,
//                 deleted_by = $1,
//                 deleted_at = NOW()
//             WHERE table_name = 'users'
//               AND record_id = $2
//               AND locked_by = $3
//               AND is_deleted = FALSE
//             `,
//             [modified_by, user_uuid, modified_by]
//         );

//         await client.query('COMMIT');

//         return cb(null, {
//             header_type: "SUCCESS",
//             message_visibility: true,
//             status: true,
//             code: 1000,
//             message: "User updated successfully",
//             data: update.rows[0]
//         });

//     } catch (err) {
//         await client.query('ROLLBACK');

//         logger.error("Responder Error (update user):", err);
//         return cb(null, {
//             header_type: "ERROR",
//             message_visibility: true,
//             status: false,
//             code: 2004,
//             message: "Update failed",
//             error: err.message
//         });
//     } finally {
//         client.release();
//     }
// });

responder.on('update-users', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { user_uuid } = req;
        const {
            username, fullname, password,
            email,
            phone_number, user_type_uuid,
            role_uuid,
            profile_icon,
            modified_by, reporting_to, is_active,
        } = req.body;

        if (!user_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "User UUID is required"
            });
        }

        if (!username || !username.trim()) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Username is required"
            });
        }

        const usernameTrim = username.trim();

        /* ======================================================
           CHECK EDIT LOCK
        ====================================================== */
        const lockCheck = await client.query(
            `
            SELECT 1
            FROM record_locks
            WHERE table_name = 'users'
              AND record_id = $1
              AND locked_by = $2
              AND is_deleted = FALSE
              AND expires_at > NOW()
            `,
            [user_uuid, modified_by]
        );

        if (lockCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2005,
                message: "Update failed",
                error: "You must lock the record before updating"
            });
        }

        // ---------- ROLE ----------
        const roleResult = await client.query(
            `SELECT role_id FROM user_role 
             WHERE role_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            [role_uuid]
        );

        if (roleResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Role not found"
            });
        }

        const role_id = roleResult.rows[0].role_id;

        // ---------- USER TYPE ----------
        const userTypeResult = await client.query(
            `SELECT user_type_id FROM user_types 
             WHERE user_type_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            [user_type_uuid]
        );

        if (userTypeResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "User type not found"
            });
        }

        const user_type_id = userTypeResult.rows[0].user_type_id;

        // ---------- DUPLICATE CHECK ----------
        const duplicate = await client.query(
            `
            SELECT user_id 
            FROM users 
            WHERE 
            (
                LOWER(username) = LOWER($1)
                OR LOWER(email) = LOWER($2)
                OR phone_number = $3
            )
            AND is_deleted = FALSE
            AND is_active = TRUE
            AND user_uuid != $4
            `,
            [usernameTrim, email.trim(), phone_number, user_uuid]
        );

        if (duplicate.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Updation failed",
                error: "Username, email or phone number already exists"
            });
        }

        // ---------- CHECK USER EXISTS ----------
        const exists = await client.query(
            `SELECT profile_icon, password_hash FROM users
             WHERE user_uuid = $1 AND is_deleted = FALSE`,
            [user_uuid]
        );

        if (exists.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "User not found"
            });
        }

        const existingPath     = exists.rows[0].profile_icon;
        const existingPassword = exists.rows[0].password_hash;

        // ---------- HASH PASSWORD (only if new password provided) ----------
        const password_hash = password
            ? await bcrypt.hash(password, 10)
            : existingPassword;

        // ---------- UPDATE USER (user_code excluded — read only) ----------
        const update = await client.query(
            `
            UPDATE users
            SET 
                username      = $1,
                email         = $2,
                phone_number  = $3,
                role_id       = $4,
                modified_by   = $5,
                modified_at   = NOW(),
                fullname      = $7,
                reporting_to  = $8,
                is_active     = $9,
                profile_icon  = $10,
                user_type_id  = $11,
                password_hash = $12
            WHERE user_uuid = $6
            RETURNING *
            `,
            [
                usernameTrim,
                email,
                phone_number,
                role_id,
                modified_by,
                user_uuid,
                fullname,
                reporting_to,
                is_active,
                profile_icon || existingPath,
                user_type_id,
                password_hash || existingPassword,
            ]
        );

        /* ======================================================
           AUTO-UNLOCK AFTER SUCCESS
        ====================================================== */
        await client.query(
            `
            UPDATE record_locks
            SET is_deleted = TRUE,
                deleted_by = $1,
                deleted_at = NOW()
            WHERE table_name = 'users'
              AND record_id = $2
              AND locked_by = $3
              AND is_deleted = FALSE
            `,
            [modified_by, user_uuid, modified_by]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "User updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');

        logger.error("Responder Error (update user):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Update failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});


// --------------------------------------------------
// DELETE USER (SOFT DELETE)
// --------------------------------------------------
responder.on('delete-users', async (req, cb) => {
    try {
        const user_uuid = req.user_uuid;
        const deleted_by = req.body.deleted_by;

        if (!user_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "User UUID is required"
            });
        }

        // --------------------------------------------------
        // CHECK IF USER EXISTS
        // --------------------------------------------------
        const check = await pool.query(
            `SELECT user_id FROM users 
             WHERE user_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            [user_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "User not found"
            });
        }

        // --------------------------------------------------
        // SOFT DELETE USER
        // --------------------------------------------------
        await pool.query(
            `
            UPDATE users
            SET 
                is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
            WHERE user_uuid = $2
            `,
            [deleted_by, user_uuid]
        );

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "User deleted successfully"
        });

    } catch (err) {
        logger.error("Responder Error (delete user):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});


// --------------------------------------------------
// UPDATE USER STATUS (ACTIVE / INACTIVE)
// --------------------------------------------------
responder.on('status-users', async (req, cb) => {
    try {
        const user_uuid = req.user_uuid;
        const modified_by = req.body.modified_by;

        if (!user_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "User UUID is required"
            });
        }

        // --------------------------------------------------
        // CHECK USER
        // --------------------------------------------------
        const check = await pool.query(
            `
            SELECT user_id, is_active 
            FROM users 
            WHERE user_uuid = $1 AND is_deleted = FALSE
            `,
            [user_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "User not found"
            });
        }

        const currentStatus = check.rows[0].is_active;
        const newStatus = !currentStatus; // Toggle active/inactive

        // --------------------------------------------------
        // UPDATE STATUS
        // --------------------------------------------------
        await pool.query(
            `
            UPDATE users
            SET 
                is_active = $1,
                modified_by = $2,
                modified_at = NOW()
            WHERE user_uuid = $3
            `,
            [newStatus, modified_by, user_uuid]
        );

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: newStatus ? "User activated successfully" : "User deactivated successfully"
        });

    } catch (err) {
        logger.error("Responder Error (status user):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});


// --------------------------------------------------
// ADVANCED FILTER — USERS
// --------------------------------------------------
responder.on('advancefilter-users', async (req, cb) => {
    try {


        const accessScope = req.dataAccessScope;
        let extraWhere = '';
        let extraParams = [];

        // If PRIVATE → only show own created data
        if (accessScope && accessScope.type === 'PRIVATE') {
            extraWhere = ' AND U.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table: 'users',
            alias: 'U',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators ON U.created_by = creators.user_uuid
                LEFT JOIN users updaters ON U.modified_by = updaters.user_uuid
                LEFT JOIN users reto ON U.reporting_to = reto.user_uuid
                LEFT JOIN user_role R ON U.role_id = R.role_id
                LEFT JOIN user_types T ON U.user_type_id = T.user_type_id

            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'username', 'email', 'phone_number', 'user_type_name',
                'role_id', 'user_type_id', 'role_name', 'owner_id', 'reporting_to',
                'is_active', 'created_at', 'modified_at',
                'createdByName', 'updatedByName', 'fullname', 'reporting_to_name'
            ],

            /* ---------------- Custom Joined Fields ---------------- */
            customFields: {
                role_name: {
                    select: 'R.role_name',
                    search: 'R.role_name',
                    sort: 'R.role_name'
                },
                user_type_name: {
                    select: 'T.name',
                    search: 'T.name',
                    sort: 'T.name'
                },
                createdByName: {
                    select: 'creators.username',
                    search: 'creators.username',
                    sort: 'creators.username'
                },
                updatedByName: {
                    select: 'updaters.username',
                    search: 'updaters.username',
                    sort: 'updaters.username'
                },
                reporting_to_name: {
                    select: 'reto.username',
                    search: 'reto.username',
                    sort: 'reto.username'
                }
            },

            /* ---------------- Base Where ---------------- */
            baseWhere: `
                U.is_deleted = FALSE ${extraWhere}
            `,
            baseParams: extraParams
        });

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "User details fetched successfully",
            error: null,
            result
        });

    } catch (err) {
        console.error('[advancefilter-users] error:', err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});


// --------------------------------------------------
// FORGOT PASSWORD 
// --------------------------------------------------
responder.on('forgotpassword-users', async (req, cb) => {
    try {
        const { username } = req.body;


        if (!username) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Username is required"
            });
        }

        // 1. Check user exist
        const checkUser = await pool.query(
            `SELECT user_uuid,email, username FROM users 
             WHERE username = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [username]
        );

        if (checkUser.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "User not found"
            });
        }

        const user = checkUser.rows[0];
        var emailid = user.email;
        var commonURL = APP_CONFIG.AngularRedirectURL;

        // encrypting
        var encrypted_loginID = user.user_uuid;
        var encrypted_username = username;


        var subject = "Reset Forgot Password";
        var content = `Dear ` + username + `,` + '<br/>' + `<br/> You have requested for a password reset.
    Please  <a href="`+ commonURL + `?AXHLKDNZVK=` + encrypted_loginID + `&PXBQFODBTI=` + true + `&OTZHSFGSKC=` + encrypted_username + `">click </a>
     here to reset the password.<br/><br/> Thanks and Best Regards,  <br/> From German Experts.`
        var objmail = {
            subject: subject,
            content: content,
            description: "",
            tomail: emailid
            //tomail: "chitra.k@germanexperts.ae"
        }

        await sendmail(objmail).then(
            async result => {
                console.log("result", result);
                return cb(null, {
                    header_type: "SUCCESS",
                    message_visibility: true,
                    status: true,
                    code: 1000,
                    message: "Email sent successfully!",
                    error: null
                });
            })



    } catch (err) {
        logger.error("Responder Error (forgotpassword-users):", err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});


// --------------------------------------------------
// RESET PASSWORD 
// --------------------------------------------------
responder.on('changepassword-users', async (req, cb) => {
    try {
        const { user_uuid, old_password, new_password, confirm_password } = req.body;
        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!user_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "User UUID is required"
            });
        }

        if (!old_password || !new_password || !confirm_password) {

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "All fields are required"
            };
        }

        if (new_password !== confirm_password) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Password change failed",
                error: 'Passwords do not match'
            });
        }

        // -----------------------------
        // FETCH USER
        // -----------------------------
        const userResult = await pool.query(
            `SELECT user_id,email,password_hash,username, is_active 
             FROM users 
             WHERE user_uuid = $1 AND is_deleted = false`,
            [user_uuid]
        );

        if (userResult.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "User not found"
            });
        }

        const user = userResult.rows[0];
        var emailid = user.email;
        if (!user.is_active) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: 'User inactive'
            });
        }

        // -----------------------------
        // VERIFY OLD PASSWORD
        // -----------------------------
        const match = await bcrypt.compare(old_password, user.password_hash);
        if (!match) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Old password is incorrect"
            });
        }

        // -----------------------------
        // HASH NEW PASSWORD
        // -----------------------------
        const newPasswordHash = await bcrypt.hash(new_password, 10);

        // -----------------------------
        // UPDATE PASSWORD
        // -----------------------------
        await pool.query(
            `UPDATE users 
             SET password_hash = $1, modified_at = now(),
             modified_by = $2 
             WHERE user_id = $3`,
            [newPasswordHash, user_uuid, user.user_id]
        );

        // 1. Check Users Login Details
        const checkUser = await pool.query(
            `SELECT login_uuid,user_id, login_id FROM users_login 
             WHERE user_id = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [user.user_id]
        );
        const sessionuser = checkUser.rows[0];

        // Close previous active sessions
        await pool.query(
            `UPDATE user_session
             SET is_active = false, end_time = NOW()
             WHERE login_id = $1 AND is_active = true`,
            [sessionuser.login_id]
        );

        await pool.query(
            `UPDATE users SET is_online = false WHERE user_id = $1`,
            [user.user_id]
        );


        var subject = "New Password Added";
        var content = "Dear " + user.username + "," + '<br/>' + '<br/>' + "New Password   " + "'" + new_password + "'" + " " + "Added Successfully .Please Login with new password." + '<br/>' + '<br/>' + "Thanks and Best Regards," + '<br/>' + '<br/>' + "From German Experts.";
        var objmail = {
            subject: subject,
            content: content,
            description: "",
            tomail: emailid
            //tomail: "chitra.k@germanexperts.ae"
        }

        await sendmail(objmail).then(
            async result => {
                console.log("result", result);

                // -----------------------------
                // RESPONSE
                // -----------------------------
                return cb(null, {
                    header_type: "SUCCESS",
                    message_visibility: true,
                    status: true,
                    code: 1000,
                    message: 'Password changed successfully. Please login again.'
                });
            })



    } catch (err) {
        logger.error("Responder Error (changepassword-users):", err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});

// --------------------------------------------------
// GET BY ID WITH EDIT LOCKING
// --------------------------------------------------


responder.on('getById-user', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { user_uuid } = req;
        const mode = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        if (!user_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "User UUID is required"
            });
        }

        await client.query('BEGIN');

        // ---------------- FETCH USER ----------------
        const userRes = await client.query(
            `SELECT *
             FROM users
             WHERE user_uuid = $1
               AND is_deleted = FALSE`,
            [user_uuid]
        );

        if (userRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                status: false,
                code: 2003,
                message: "User not found",
                data: {}
            });
        }

        const user = userRes.rows[0];

        // ---------------- LOCK HANDLING ----------------
        let lockRow = null;

        if (mode === 'edit') {

            if (!user_id) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "User ID required for edit mode"
                });
            }

            const lockRes = await client.query(
                `SELECT RL.*, U.username AS locked_by_name
                 FROM record_locks RL
                 LEFT JOIN users U ON U.user_uuid = RL.locked_by
                 WHERE RL.table_name = 'users'
                   AND RL.record_id = $1
                   AND RL.is_deleted = FALSE`,
                [user_uuid]
            );

            lockRow = lockRes.rows[0];

            const isExpired =
                lockRow &&
                new Date(lockRow.expires_at).getTime() < Date.now();

            // Locked by another user
            if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                await client.query('ROLLBACK');
                return cb(null, {
                    status: false,
                    code: 2005,
                    message: `Record is locked by ${lockRow.locked_by_name}`
                });
            }

            // Expired → clear lock
            if (lockRow && isExpired) {
                await client.query(
                    `UPDATE record_locks
                     SET is_deleted = TRUE,
                         deleted_by = $1,
                         deleted_at = NOW()
                     WHERE lock_id = $2`,
                    [user_id, lockRow.lock_id]
                );
                lockRow = null;
            }

            // Create new lock
            if (!lockRow) {
                const newLock = await client.query(
                    `INSERT INTO record_locks(
                        table_name, record_id, locked_by, expires_at, created_by
                    )
                    VALUES(
                        'users', $1, $2,
                        NOW() + ($3 || ' minute')::INTERVAL, $2
                    )
                    RETURNING *`,
                    [user_uuid, user_id, LOCK_MINUTES]
                );

                lockRow = newLock.rows[0];
            }
            // Refresh existing lock
            else if (lockRow.locked_by === user_id) {
                const refresh = await client.query(
                    `UPDATE record_locks
                     SET expires_at = NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id = $1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );

                lockRow = refresh.rows[0];
            }
        }

        await client.query('COMMIT');

        // ---------------- FINAL LOCK STATUS ----------------
        user.lock_status =
            lockRow &&
            new Date(lockRow.expires_at).getTime() >= Date.now();

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "User fetched successfully",
            data: user,
            lock: lockRow
                ? {
                    status: user.lock_status,
                    by: lockRow.locked_by,
                    by_name: lockRow.locked_by_name,
                    expires_at: lockRow.expires_at
                }
                : {
                    status: false
                }
        });

    } catch (err) {
        await client.query('ROLLBACK');

        logger.error("Responder Error (getById user):", err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Fetch failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// UNLOCK RECORD
// --------------------------------------------------

responder.on(`unlock-user`, async (req, cb) => {
    const client = await pool.connect();
    try {
        const { uuid } = req;
        const user_id = req.body?.user_id;

        if (!user_id) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "User ID required",
                error: "User ID missing"
            });
        }

        await client.query('BEGIN');

        // Delete lock only if same user owns it

        const result = await client.query(
            `
            DELETE FROM record_locks
            WHERE table_name = 'users'
              AND record_id = $1
              AND locked_by = $2
              AND is_deleted = FALSE
            `,
            [uuid, user_id]
        );

        // No lock deleted → locked by another user OR already expired/unlocked
        if (!result.rowCount) {
            await client.query('ROLLBACK');

            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Unable to unlock record",
                error: "This record is currently being edited by another user or already unlocked"
            });
        }

        await client.query('COMMIT');

        // Success
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: `User record unlocked successfully`,
        });

    } catch (err) {
        await client.query('ROLLBACK');

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    } finally {
        client.release();
    }
});


// --------------------------------------------------
// LIST SUPER ADMIN
// --------------------------------------------------

responder.on('list-super-admin', async (req, cb) => {
    try {
        const query = {
            text: `
                SELECT 
                    u.user_id,
                    u.user_uuid,
                    u.username,
                    u.fullname,
                    u.email,
                    u.phone_number,
                    u.user_type_id,
                    u.reporting_to,
                    u.profile_icon,
                    u.is_online,
                    u.force_logout,
                    u.last_login,
                    u.is_active,
                    u.created_at,
                    u.created_by,
                    u.modified_at,
                    u.modified_by,
                    u.deleted_at,
                    u.deleted_by,
                    u.is_deleted,
                    
                    -- Created & Updated Usernames
                    creators.username AS createdByName,
                    updaters.username AS updatedByName,

                    -- Role Info
                    r.role_name,
                    r.role_uuid,
                    t.name AS usertype_name
                FROM users u
                LEFT JOIN users creators 
                    ON u.created_by = creators.user_uuid
                LEFT JOIN users updaters 
                    ON u.modified_by = updaters.user_uuid
                LEFT JOIN user_role r
                    ON u.role_id = r.role_id
                LEFT JOIN user_types t
                    ON u.user_type_id = t.user_type_id
                WHERE 
                    u.is_deleted = FALSE 
                    AND u.is_active = TRUE
                    AND u.role_id = $1         
                ORDER BY 
                    u.created_at ASC
            `,
            values: [
                commonenum.ROLE_ID.SUPER_ADMIN
            ]
        };

        const result = await pool.query(query);

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Super Admin list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("Responder Error (list users):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});

// --------------------------------------------------
// UPDATE SUPER ADMIN
// --------------------------------------------------

responder.on('update-super-admin', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const {
            username, fullname, password, user_code,
            email,
            phone_number, user_type_id,
            role_id, profile_icon,
            modified_by, reporting_to, is_active,
        } = req.body;

        if (!username || !username.trim()) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Username is required"
            });
        }

        const usernameTrim = username.trim();
        const userResult = await client.query(
            `SELECT user_uuid FROM users WHERE role_id = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            [commonenum.ROLE_ID.SUPER_ADMIN]
        );

        const user_uuid = userResult.rows[0]?.user_uuid;
        // --------------------------------------------------
        // CHECK DUPLICATE 
        // --------------------------------------------------
        const duplicate = await client.query(
            `
            SELECT user_id 
            FROM users 
            WHERE 
            (
                LOWER(username) = LOWER($1)
                OR LOWER(email) = LOWER($2)
                OR phone_number = $3
            )
            AND is_deleted = FALSE
            AND is_active = TRUE
            AND user_uuid != $4
            `,
            [usernameTrim, email, phone_number, user_uuid]
        );


        if (duplicate.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Updation failed",
                error: "Username, email or phone number already exists"
            });
        }

        // ---------- USER CODE UNIQUENESS CHECK ----------
        if (user_code) {
            const existingCode = await pool.query(
                `SELECT 1 FROM users 
                 WHERE user_code = $1 
                   AND user_uuid <> $2`,
                [user_code, user_uuid]
            );

            if (existingCode.rows.length > 0) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "User code already exists"
                });
            }
        }
        // -----------------------------
        // CHECK PROFILE ICON EXISTS
        // -----------------------------
        const exists = await client.query(
            `SELECT profile_icon,user_code,fullname,password_hash,email,phone_number,role_id,reporting_to,modified_by,user_type_id,is_active FROM users
             WHERE user_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            [user_uuid]
        );

        if (exists.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "User not found"
            });
        }

        const existingPath = exists.rows[0].profile_icon;
        const existingFullname = exists.rows[0].fullname;
        const existingPassword = exists.rows[0].password_hash;
        const existingEmail = exists.rows[0].email;
        const existingPhone = exists.rows[0].phone_number;
        const existingRoleId = exists.rows[0].role_id;
        const existingReporting = exists.rows[0].reporting_to;
        const existingModifiedBy = exists.rows[0].modified_by;
        const existingUserType = exists.rows[0].user_type_id;
        const existingIsActive = exists.rows[0].is_active;
        const existingUserCode = exists.rows[0].user_code;

        // --------------------------------------------------
        // HASH PASSWORD (only if new password is provided)
        // --------------------------------------------------
        const password_hash = password
            ? await bcrypt.hash(password, 10)
            : existingPassword;
        // --------------------------------------------------
        // UPDATE USER
        // --------------------------------------------------
        const update = await client.query(
            `
            UPDATE users
            SET 
                username = $1,
                email = $2,
                phone_number = $3,
                role_id = $4,
                modified_by = $5,
                modified_at = NOW(),
                fullname = $7,
                reporting_to = $8,
                is_active = $9,
                profile_icon = $10,
                user_type_id = $11,
password_hash = $12,
user_code = $13
            WHERE user_uuid = $6
            RETURNING *
            `,
            [
                usernameTrim,
                email || existingEmail,
                phone_number || existingPhone,
                role_id || existingRoleId,
                modified_by || existingModifiedBy,
                user_uuid,
                fullname || existingFullname,
                reporting_to || existingReporting,
                is_active ?? existingIsActive,
                profile_icon || existingPath,
                user_type_id || existingUserType,
                password_hash || existingPassword,
                user_code || existingUserCode
            ]
        );



        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Record updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');

        logger.error("Responder Error (update):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Update failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});






