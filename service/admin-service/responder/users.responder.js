require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { saveLoginLog, sendmail } = require('@libs/common/common-util');
const APP_CONFIG = require('@libs/config/config.prod');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'admin-users responder',
    key: 'admin-users',
    redis: { host: redisHost, port: redisPort }
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
            phone_number,
            role_id,
            created_by, reporting_to
        } = req.body;

        // --------------------------------------------------
        // VALIDATION
        // --------------------------------------------------
        if (!username?.trim()) {
            return cb(null, { status: false, code: 2001, error: "Username is required" });
        }
        if (!password?.trim()) {
            return cb(null, { status: false, code: 2001, error: "Password is required" });
        }
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
                status: false, code: 2002,
                error: "User already exists (username/email/phone)"
            });
        }

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
                    (username,fullname, email, password_hash, phone_number, role_id,reporting_to, created_by)
                VALUES 
                    ($1, $2, $3, $4, $5, $6,$7)
                RETURNING 
                    user_id, user_uuid, username, email, phone_number, role_id, is_active
            `,
            values: [
                usernameTrim, fullname,
                email,
                password_hash,
                phone_number,
                role_id,reporting_to,
                created_by,
            ]
        };

        const insert = await pool.query(insertQuery);

        return cb(null, {
            status: true, code: 1000,
            message: "User created successfully",
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (create user):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// LIST USERS
// --------------------------------------------------
responder.on('list-users', async (req, cb) => {
    try {

        const query = `
            SELECT 
                u.user_id,
                u.user_uuid,
                u.username,u.fullname,
                u.email,
                u.phone_number,
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
                r.role_uuid

            FROM users u

            LEFT JOIN users creators 
                ON u.created_by = creators.user_uuid

            LEFT JOIN users updaters 
                ON u.modified_by = updaters.user_uuid

            LEFT JOIN user_role r
                ON u.role_id = r.role_id

            WHERE 
                u.is_deleted = FALSE

            ORDER BY 
                u.created_at ASC
        `;

        const result = await pool.query(query);

        return cb(null, {
            status: true, code: 1000,
            message: "Users list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("Responder Error (list users):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// GET USER BY ID
// --------------------------------------------------
responder.on('getById-users', async (req, cb) => {
    try {
        const { user_uuid } = req;

        if (!user_uuid) {
            return cb(null, { status: false, code: 2001, error: "User UUID is required" });
        }

        const result = await pool.query(
            `
            SELECT 
                u.user_id,
                u.user_uuid,
                u.username,
                u.fullname,
                u.email,
                u.phone_number,
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

                r.role_name,
                r.role_uuid,

                creators.username AS createdByName,
                updaters.username AS updatedByName

            FROM users u
            LEFT JOIN user_role r 
                ON u.role_id = r.role_id
            LEFT JOIN users creators 
                ON u.created_by = creators.user_uuid
            LEFT JOIN users updaters 
                ON u.modified_by = updaters.user_uuid

            WHERE 
                u.user_uuid = $1
                AND u.is_deleted = FALSE
            `,
            [user_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "User not found" });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        logger.error("Responder Error (getById user):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// UPDATE USER
// --------------------------------------------------
responder.on('update-users', async (req, cb) => {
    try {
        const { user_uuid, body } = req;

        const {
            username, fullname,
            email,
            phone_number,
            role_id,
            modified_by,reporting_to,is_active,
        } = body;

        if (!user_uuid) {
            return cb(null, { status: false, code: 2001, error: "User UUID is required" });
        }

        if (!username || !username.trim()) {
            return cb(null, { status: false, code: 2001, error: "Username is required" });
        }

        // --------------------------------------------------
        // CHECK DUPLICATE (username, email, phone)
        // excluding this user
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
            AND user_uuid != $6
        `,
            values: [
                usernameTrim,
                usernameLower,
                usernameUpper,
                email.trim(),
                phone_number,
                user_uuid
            ]
        };


        const duplicate = await pool.query(duplicateQuery);

        if (duplicate.rowCount > 0) {
            return cb(null, {
                status: false, code: 2002,
                error: "Username, email, or phone already exists"
            });
        }

        // --------------------------------------------------
        // UPDATE USER
        // --------------------------------------------------
        const updateQuery = `
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
                is_active=$9
            WHERE user_uuid = $6
            RETURNING 
                user_id, user_uuid, username, email, phone_number, role_id,
                is_active, created_at, modified_at,fullname,reporting_to
        `;

        const update = await pool.query(updateQuery, [
            usernameTrim,
            email,
            phone_number,
            role_id,
            modified_by,
            user_uuid,
            fullname,reporting_to,
            is_active
        ]);

        return cb(null, {
            status: true, code: 1000,
            message: "User updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (update user):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
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
            return cb(null, { status: false, code: 2001, error: "User UUID is required" });
        }

        // --------------------------------------------------
        // CHECK IF USER EXISTS
        // --------------------------------------------------
        const check = await pool.query(
            `SELECT user_id FROM users 
             WHERE user_uuid = $1 AND is_deleted = FALSE`,
            [user_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "User not found" });
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
            status: true, code: 1000,
            message: "User deleted successfully"
        });

    } catch (err) {
        logger.error("Responder Error (delete user):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
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
            return cb(null, { status: false, code: 2001, error: "User UUID is required" });
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
            return cb(null, { status: false, code: 2003, error: "User not found" });
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
            status: true, code: 1000,
            message: newStatus ? "User activated successfully" : "User deactivated successfully"
        });

    } catch (err) {
        logger.error("Responder Error (status user):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// ADVANCED FILTER — USERS
// --------------------------------------------------
responder.on('advancefilter-users', async (req, cb) => {
    try {

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
                LEFT JOIN users reto ON U.reporting_to = reto.user_id
                LEFT JOIN user_role R ON U.role_id = R.role_id
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'username', 'email', 'phone_number',
                'role_id', 'role_name', 'owner_id','reporting_to',
                'is_active', 'created_at', 'modified_at',
                'createdByName', 'updatedByName', 'fullname','reporting_to_name'
            ],

            /* ---------------- Custom Joined Fields ---------------- */
            customFields: {
                role_name: {
                    select: 'R.role_name',
                    search: 'R.role_name',
                    sort: 'R.role_name'
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
                U.is_deleted = FALSE
            `
        });

        return cb(null, {
            status: true, code: 1000,
            result
        });

    } catch (err) {
        console.error('[advancefilter-users] error:', err);
        return cb(null, { status: false, code: 2004, error: err.message });
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
            return cb(null, { status: false, code: 2001, error: "User UUID is required" });
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
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


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
        return cb(null, { status: false, code: 2004, error: err.message });
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

    const accessToken = jwt.sign(
        { user_id: user.user_id, user_uuid: user.user_uuid, username: user.username, login_id: user.login_id },
        'a4db08b7-5729-4ba9-8c08-f2df493465a1',
        { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || "24h" }
    );

    const refreshToken = jwt.sign(
        { user_id: user.user_id },
        'a4db08b7-5729-4ba9-8c08-f2df493465a1',
        { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "48h" }
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


// --------------------------------------------------
// FORGOT PASSWORD USER
// --------------------------------------------------
responder.on('forgotpassword-users', async (req, cb) => {
    try {
        const { username } = req.body;

        if (!username) {
            return cb(null, { status: false, error: "Username is required" });
        }

        // 1. Check user exist
        const checkUser = await pool.query(
            `SELECT user_uuid, username FROM users 
             WHERE username = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [username]
        );

        if (checkUser.rowCount === 0) {
            return cb(null, { status: false, error: "User not found" });
        }

        const user = checkUser.rows[0];
        var emailid = user.emailid;
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
            //   tomail: emailid
            tomail: "manikandan.p@germanexperts.ae"
        }

        await sendmail(objmail).then(
            async result => {
                console.log("result", result);
                return cb(null, {
                    status: true,
                    message: "Send successfully!"
                });
            })



    } catch (err) {
        logger.error("Responder Error (forgotpassword-users):", err);
        return cb(null, { status: false, error: err.message });
    }
});



// --------------------------------------------------
// CHANGE PASSWORD USER
// --------------------------------------------------
responder.on('changepassword-users', async (req, cb) => {
    try {
        const { user_uuid, old_password, new_password, confirm_password } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!user_uuid) {
            return cb(null, { status: false, code: 2001, error: 'User UUID required' });
        }

        if (!old_password || !new_password || !confirm_password) {
            return cb(null, { status: false, code: 2001, error: 'All fields are required' });
        }

        if (new_password !== confirm_password) {
            return cb(null, { status: false, code: 2002, error: 'Passwords do not match' });
        }

        // -----------------------------
        // FETCH USER
        // -----------------------------
        const userResult = await pool.query(
            `SELECT user_id, password_hash,username, is_active 
             FROM users 
             WHERE user_uuid = $1 AND is_deleted = false`,
            [user_uuid]
        );

        if (userResult.rowCount === 0) {
            return cb(null, { status: false, code: 2004, error: 'User not found' });
        }

        const user = userResult.rows[0];

        if (!user.is_active) {
            return cb(null, { status: false, code: 2005, error: 'User inactive' });
        }

        // -----------------------------
        // VERIFY OLD PASSWORD
        // -----------------------------
        const match = await bcrypt.compare(old_password, user.password_hash);
        if (!match) {
            return cb(null, { status: false, code: 2006, error: 'Old password incorrect' });
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
             SET password_hash = $1, modified_at = now() 
             WHERE user_id = $2`,
            [newPasswordHash, user.user_id]
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
             SET is_active = false, end_date = NOW()
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
            //   tomail: emailid
            tomail: "manikandan.p@germanexperts.ae"
        }

        await sendmail(objmail).then(
            async result => {
                console.log("result", result);

                // -----------------------------
                // RESPONSE
                // -----------------------------
                return cb(null, {
                    status: true,
                    code: 1000,
                    message: 'Password changed successfully. Please login again.'
                });
            })



    } catch (err) {
        logger.error("Responder Error (changepassword-users):", err);
        return cb(null, {
            status: false,
            code: 2007,
            error: 'Internal server error'
        });
    }
});









