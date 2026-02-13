require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { saveLoginLog, sendmail } = require('@libs/common/common-util');
const APP_CONFIG = require('@libs/config/config.prod');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'buyer-users responder',
    key: 'buyer-users',
    redis: { host: redisHost, port: redisPort }
});


// --------------------------------------------------
// LIST USERS
// --------------------------------------------------
responder.on('list-users', async (req, cb) => {
    try {

        const query = `
            SELECT 
                u.portal_user_id,
                u.portal_user_uuid,
                u.username,u.full_name,
                u.email,
                u.phone_number,
                -- u.role_id,
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

            FROM portal_users u

            LEFT JOIN portal_users creators 
                ON u.created_by = creators.portal_user_uuid

            LEFT JOIN portal_users updaters 
                ON u.modified_by = updaters.portal_user_uuid

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

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table: 'portal_users',
            alias: 'U',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN portal_users creators ON U.created_by = creators.portal_user_uuid
                LEFT JOIN portal_users updaters ON U.modified_by = updaters.portal_user_uuid
                LEFT JOIN user_role R ON U.role_id = R.role_id
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'username', 'email', 'phone_number',
                'role_id', 'role_name', 'owner_id',
                'is_active', 'created_at', 'modified_at',
                'createdByName', 'updatedByName', 'full_name'
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


responder.on('forgotpassword-users', async (req, cb) => {
    try {
        const { email } = req.body;

        if (!email) {
            return cb(null, { status: false, error: "Email is required" });
        }

        // 1. Check user exist
        const checkUser = await pool.query(
            `SELECT portal_user_uuid, email FROM users 
             WHERE email = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [email]
        );

        if (checkUser.rowCount === 0) {
            return cb(null, { status: false, error: "User not found" });
        }

        const user = checkUser.rows[0];

        // 2. Generate OTP (6 digits)
        const otp = Math.floor(100000 + Math.random() * 900000);

        // 3. Save OTP in DB
        await pool.query(
            `UPDATE users SET 
                reset_otp = $1,
                reset_otp_expiry = NOW() + INTERVAL '10 minutes'
             WHERE portal_user_uuid = $2`,
            [otp, user.portal_user_uuid]
        );

        // 4. Send Email (Optional - add your mail code)
        // await sendEmail(email, "Your Password Reset OTP", `Your OTP is: ${otp}`);

        return cb(null, {
            status: true,
            message: "OTP sent to your email",
            otp        // ❗ remove this in production
        });

    } catch (err) {
        logger.error("Responder Error (forgotpassword-users):", err);
        return cb(null, { status: false, error: err.message });
    }
});


// --------------------------------------------------
// LOGIN API
// --------------------------------------------------

responder.on("buyer-login", async (req, cb) => {
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

        const query = {
            text: `
                SELECT 
                u.portal_user_id,
                u.portal_user_uuid,
                u.username,
                u.email,
                u.phone_number,
                u.password_hash,
                u.is_active,

                ul.login_id,
                ul.login_uuid
                FROM portal_users u
                LEFT JOIN users_login ul
                ON ul.portal_user_id = u.portal_user_id
                WHERE
                (u.username = $1 OR u.email = $1 OR u.phone_number = $1)
                AND u.is_deleted = FALSE
            `,
            values: [usernameTrim]
        };

        const result = await pool.query(query);


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

        delete user.password_hash;

        // -------------------------
        // Update users table → Online Status
        // -------------------------
        const userUpdateQuery = `
        UPDATE portal_users
        SET is_online = true WHERE portal_user_id = $1 AND is_deleted = false`;

        await pool.query(userUpdateQuery, [user.portal_user_id]);

        // Log login details
        const loginDetails = await saveLoginLog({
            user_id: null,
            portal_user_id: user.portal_user_id,
            device_detail: device_detail,
            browser_used: browser_used,
            created_by: user.portal_user_uuid
        });

        // ADD LOGINID IN OBJECT
        user.login_id = loginDetails.data.login_id


        // -----------------------------------------
        // CHECK ACTIVE ACCESS TOKEN
        // -----------------------------------------
        const sessionCheck = await pool.query(
            `SELECT * FROM user_access_tokens 
             WHERE portal_user_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1`,
            [user.portal_user_id]
        );

        let finalAccessToken = null;
        let finalRefreshToken = null;

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
            user.portal_user_uuid,
            finalAccessToken,
            device_detail || browser_used || "login"
        );



        return cb(null, {
            status: true,
            code: 1000,
            message: "Login successful",
            data: {
                ...user,
                accessToken: finalAccessToken,
                // refreshToken: finalRefreshToken
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
            WHERE portal_user_id = $1
              AND is_active = true
              AND expires_at > NOW()
            LIMIT 1
            `,
            [user.portal_user_id]
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
            WHERE portal_user_id = $2
              AND is_active = true
            `,
            [user.portal_user_uuid, user.portal_user_id]
        );

        // 4. Insert new token
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

        const result = await pool.query(
            `
            INSERT INTO user_tokens
            (portal_user_id, refresh_token, is_active, expires_at, created_by, created_at)
            VALUES ($1, $2, true, $3, $4, NOW())
            RETURNING user_token_id
            `,
            [user.portal_user_id, refreshToken, expiresAt, user.portal_user_uuid]
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
             WHERE portal_user_id = $2 AND is_active = true`,
            [user.portal_user_uuid, user.portal_user_id]
        );

        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

        await pool.query(
            `INSERT INTO user_access_tokens
             (portal_user_id, access_token, is_active, expires_at, created_by, created_at, user_token_id)
             VALUES ($1, $2, true, $3, $4, NOW(), $5)`,
            [user.portal_user_id, accessToken, expiresAt, user.portal_user_uuid, user_token_id]
        );

    } catch (err) {
        console.error("storeAccessToken error:", err);
        throw err;
    }
}

// --------------------------------------------------
// Create User Session
// --------------------------------------------------
async function createUserSession(login_id, portal_user_uuid, accessToken, device_detail) {
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
            [login_id, device_detail, portal_user_uuid, accessToken]
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
        { portal_user_id: user.portal_user_id, portal_user_uuid: user.portal_user_uuid, username: user.username },
        'a4db08b7-5729-4ba9-8c08-f2df493465a1',
        { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || "24h" }
    );

    const refreshToken = jwt.sign(
        { portal_user_id: user.portal_user_id },
        'a4db08b7-5729-4ba9-8c08-f2df493465a1',
        { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "48h" }
    );

    console.log("refreshToken", refreshToken);
    return { accessToken, refreshToken };
}

// --------------------------------------------------
// LOGOUT USER
// --------------------------------------------------
responder.on("buyer-logout", async (req, cb) => {
    const { portal_user_id, access_token, } = req.body;
    const updated_by = req.body.portal_user_uuid;

    try {
        if (!portal_user_id || !access_token) {
            return cb(null, { status: false, code: 2001, error: "Missing required fields" });
        }

        // 1. Check Users Login Details
        const checkUser = await pool.query(
            `SELECT login_uuid,portal_user_id, login_id FROM users_login 
             WHERE portal_user_id = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [portal_user_id]
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
            RETURNING session_id;
        `;

        const session = await pool.query(sessionQuery, [user.login_id, access_token, updated_by]);

        if (session.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Active session not found" });
        }

        // -------------------------
        // Update users table → Offline
        // -------------------------
        const userUpdateQuery = `
            UPDATE portal_users
            SET 
                is_online = false,
                force_logout = false,
                modified_at = NOW(),
                modified_by = $2
            WHERE portal_user_id = $1
              AND is_deleted = false
        `;

        await pool.query(userUpdateQuery, [portal_user_id, updated_by]);

        // Update last active login row
        await pool.query(
            `UPDATE users_login
                 SET logout_time = NOW(), is_active = false
                 WHERE portal_user_id = $1 AND is_active = true`,
            [portal_user_id]
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
responder.on('forgotpassword-buyer', async (req, cb) => {
    try {
        const { username } = req.body;

        if (!username) {
            return cb(null, { status: false, error: "Username is required" });
        }

        // 1. Check user exist
        const checkUser = await pool.query(
            `SELECT portal_user_uuid, username FROM portal_users 
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
        var encrypted_loginID = user.portal_user_uuid;
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
responder.on('changepassword-buyer', async (req, cb) => {
    try {
        const { portal_user_uuid, old_password, new_password, confirm_password } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!portal_user_uuid) {
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
            `SELECT portal_user_id, password_hash,username, is_active 
             FROM portal_users 
             WHERE portal_user_uuid = $1 AND is_deleted = false`,
            [portal_user_uuid]
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
            `UPDATE portal_users 
             SET password_hash = $1, modified_at = now() 
             WHERE portal_user_id = $2`,
            [newPasswordHash, user.portal_user_id]
        );

        // 1. Check Users Login Details
        const checkUser = await pool.query(
            `SELECT login_uuid,portal_user_id, login_id FROM users_login 
             WHERE portal_user_id = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [user.portal_user_id]
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
            `UPDATE portal_users SET is_online = false WHERE portal_user_id = $1`,
            [user.portal_user_id]
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










