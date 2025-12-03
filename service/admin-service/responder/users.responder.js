require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');
const { saveErrorLog } = require('@libs/common/common-util');
const bcrypt = require("bcryptjs");

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'users responder',
    key: 'users',
    redis: { host: redisHost, port: redisPort }
});


// --------------------------------------------------
// CREATE USER
// --------------------------------------------------
responder.on('create-users', async (req, cb) => {
    try {
        const {
            username,
            email,
            password,
            phone_number,
            role_id,
            created_by
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

        const usernameTrim = username.trim();

        // --------------------------------------------------
        // DUPLICATE CHECK (username / email / phone)
        // --------------------------------------------------
        const duplicateQuery = {
            text: `
                SELECT user_id FROM users 
                WHERE 
                    (username = $1 
                     OR email = $2 
                     OR phone_number = $3)
                AND is_deleted = FALSE
            `,
            values: [usernameTrim, email, phone_number]
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
                    (username, email, password_hash, phone_number, role_id, created_by)
                VALUES 
                    ($1, $2, $3, $4, $5, $6)
                RETURNING 
                    user_id, user_uuid, username, email, phone_number, role_id, is_active
            `,
            values: [
                usernameTrim,
                email,
                password_hash,
                phone_number,
                role_id,
                created_by
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
        // Save log to table
        await saveErrorLog(pool, {
            api_name: 'create-users',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack
        });
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
                u.username,
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
            username,
            email,
            phone_number,
            role_id,
            modified_by
        } = body;

        if (!user_uuid) {
            return cb(null, { status: false, code: 2001, error: "User UUID is required" });
        }

        if (!username || !username.trim()) {
            return cb(null, { status: false, code: 2001, error: "Username is required" });
        }

        const usernameTrim = username.trim();

        // --------------------------------------------------
        // CHECK DUPLICATE (username, email, phone)
        // excluding this user
        // --------------------------------------------------
        const duplicateQuery = {
            text: `
                SELECT user_id FROM users 
                WHERE 
                    (username = $1 
                     OR email = $2 
                     OR phone_number = $3)
                AND is_deleted = FALSE
                AND user_uuid != $4
            `,
            values: [usernameTrim, email, phone_number, user_uuid]
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
                modified_at = NOW()
            WHERE user_uuid = $6
            RETURNING 
                user_id, user_uuid, username, email, phone_number, role_id,
                is_active, created_at, modified_at
        `;

        const update = await pool.query(updateQuery, [
            usernameTrim,
            email,
            phone_number,
            role_id,
            modified_by,
            user_uuid
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
                LEFT JOIN user_role R ON U.role_id = R.role_id
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'username', 'email', 'phone_number',
                'role_id', 'role_name',
                'is_active', 'created_at', 'modified_at',
                'createdByName', 'updatedByName'
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


responder.on('forgotpassword-users', async (req, cb) => {
    try {
        const { email } = req.body;

        if (!email) {
            return cb(null, { status: false, error: "Email is required" });
        }

        // 1. Check user exist
        const checkUser = await pool.query(
            `SELECT user_uuid, email FROM users 
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
             WHERE user_uuid = $2`,
            [otp, user.user_uuid]
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









