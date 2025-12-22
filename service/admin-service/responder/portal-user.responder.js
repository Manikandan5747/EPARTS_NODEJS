require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");


// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'portalusers responder',
    key: 'portalusers',
    redis: { host: redisHost, port: redisPort }
});


// --------------------------------------------------
// CREATE PORTAL USER
// --------------------------------------------------
responder.on("create-portal-users", async (req, cb) => {
    try {
        const {
            username,
            full_name,
            email,
            phone_number,
            password,
            user_type,
            seller_id,
            buyer_id,
            created_by
        } = req.body;
        console.log("req.body", req.body);

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!username?.trim()) {
            return cb(null, { status: false, code: 2001, error: "Username is required" });
        }
        if (!full_name?.trim()) {
            return cb(null, { status: false, code: 2001, error: "Full Name is required" });
        }
        if (!password?.trim()) {
            return cb(null, { status: false, code: 2001, error: "Password is required" });
        }
        if (!user_type?.trim()) {
            return cb(null, { status: false, code: 2001, error: "User type is required" });
        }

        const usernameTrim = username.trim();

        // -----------------------------
        // DUPLICATE CHECK
        // -----------------------------
        const duplicateQuery = {
            text: `
                SELECT portal_user_id FROM portal_users 
                WHERE (username = $1 OR email = $2 OR phone_number = $3)
                AND is_deleted = FALSE
            `,
            values: [usernameTrim, email, phone_number]
        };

        const duplicateCheck = await pool.query(duplicateQuery);

        if (duplicateCheck.rowCount > 0) {
            return cb(null, {
                status: false,
                code: 2002,
                error: "User already exists (username/email/phone)"
            });
        }

        // -----------------------------
        // HASH PASSWORD
        // -----------------------------
        const bcrypt = require("bcryptjs");
        const password_hash = await bcrypt.hash(password, 10);

        // -----------------------------
        // INSERT USER
        // -----------------------------
        const insertQuery = {
            text: `
                INSERT INTO portal_users 
                    (portal_user_uuid, username, full_name, email, phone_number,
                     password_hash, user_type, seller_id, buyer_id, created_by)
                VALUES 
                    (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING 
                    portal_user_id, portal_user_uuid, username, full_name, email, 
                    phone_number, user_type, seller_id, buyer_id, is_active
            `,
            values: [
                usernameTrim,
                full_name,
                email,
                phone_number,
                password_hash,
                user_type,
                seller_id || null,
                buyer_id || null,
                created_by || null
            ]
        };

        const insert = await pool.query(insertQuery);

        return cb(null, {
            status: true,
            code: 1000,
            message: "User created successfully",
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (create-users):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
//  LIST PORTAL USERS
// --------------------------------------------------
responder.on('list-portal-users', async (req, cb) => {
    try {

        const query = `
            SELECT 
                pu.portal_user_id,
                pu.portal_user_uuid,
                pu.username,
                pu.full_name,
                pu.email,
                pu.phone_number,
                pu.user_type,
                pu.seller_id,
                pu.buyer_id,
                pu.profile_icon,
                pu.is_online,
                pu.force_logout,
                pu.last_login,
                pu.is_active,
                pu.created_at,
                pu.created_by,
                pu.modified_at,
                pu.modified_by,
                pu.deleted_at,
                pu.deleted_by,
                pu.is_deleted,

                -- Created & Updated Usernames
                creator.username AS createdByName,
                updater.username AS updatedByName

            FROM portal_users pu

            LEFT JOIN users creator 
                ON pu.created_by = creator.user_uuid

            LEFT JOIN users updater 
                ON pu.modified_by = updater.user_uuid

            WHERE 
                pu.is_deleted = FALSE

            ORDER BY 
                pu.reated_at ASC
        `;

        const result = await pool.query(query);

        return cb(null, {
            status: true,
            code: 1000,
            message: "Portal users list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("Responder Error (list portal users):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// GET PORTAL USER BY ID
// --------------------------------------------------
responder.on('getById-portal-users', async (req, cb) => {
    try {
        const { portal_user_uuid } = req;

        if (!portal_user_uuid) {
            return cb(null, {
                status: false,
                code: 2001,
                error: "portal_user_uuid is required"
            });
        }

        const result = await pool.query(
            `
            SELECT 
                u.portal_user_id,
                u.portal_user_uuid,
                u.username,
                u.full_name,
                u.email,
                u.phone_number,
                u.user_type,
                u.seller_id,
                u.buyer_id,
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

                creators.username AS created_by_name,
                updaters.username AS updated_by_name

            FROM portal_users u

            LEFT JOIN users creators 
                ON u.created_by = creators.user_uuid

            LEFT JOIN users updaters 
                ON u.modified_by = updaters.user_uuid

            WHERE 
                u.portal_user_uuid = $1
                AND u.is_deleted = FALSE
            `,
            [portal_user_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, {
                status: false,
                code: 2003,
                error: "Portal user not found"
            });
        }

        return cb(null, {
            status: true,
            code: 1000,
            data: result.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (getById-portal-users):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});

// --------------------------------------------------
// UPDATE PORTAL USER
// --------------------------------------------------
responder.on('update-portal-users', async (req, cb) => {
    try {
        const { portal_user_uuid, body } = req;

        const {
            username,
            full_name,
            email,
            phone_number,
            user_type,
            seller_id,
            buyer_id,
            modified_by
        } = body;

        // ------------------------------------------
        // VALIDATIONS
        // ------------------------------------------
        if (!portal_user_uuid) {
            return cb(null, {
                status: false,
                code: 2001,
                error: "Portal User UUID is required"
            });
        }

        if (!username || !username.trim()) {
            return cb(null, {
                status: false,
                code: 2001,
                error: "Username is required"
            });
        }

        if (!full_name || !full_name.trim()) {
            return cb(null, {
                status: false,
                code: 2001,
                error: "Full name is required"
            });
        }

        const usernameTrim = username.trim();
        const fullNameTrim = full_name.trim();

        // --------------------------------------------------
        // DUPLICATE CHECK (username, email, phone)
        // excluding current user
        // --------------------------------------------------
        const duplicateQuery = {
            text: `
                SELECT portal_user_id FROM portal_users 
                WHERE 
                    (username = $1 
                    OR email = $2 
                    OR phone_number = $3)
                AND is_deleted = FALSE
                AND portal_user_uuid != $4
            `,
            values: [usernameTrim, email, phone_number, portal_user_uuid]
        };

        const duplicate = await pool.query(duplicateQuery);

        if (duplicate.rowCount > 0) {
            return cb(null, {
                status: false,
                code: 2002,
                error: "Username, email, or phone already exists"
            });
        }

        // --------------------------------------------------
        // UPDATE PORTAL USER
        // --------------------------------------------------
        const updateQuery = `
            UPDATE portal_users
            SET 
                username = $1,
                full_name = $2,
                email = $3,
                phone_number = $4,
                user_type = $5,
                seller_id = $6,
                buyer_id = $7,
                modified_by = $8,
                modified_at = NOW()
            WHERE portal_user_uuid = $9
            RETURNING 
                portal_user_id,
                portal_user_uuid,
                username,
                full_name,
                email,
                phone_number,
                user_type,
                seller_id,
                buyer_id,
                is_active,
                created_at,
                modified_at
        `;

        const update = await pool.query(updateQuery, [
            usernameTrim,
            fullNameTrim,
            email,
            phone_number,
            user_type,
            seller_id,
            buyer_id,
            modified_by,
            portal_user_uuid
        ]);

        return cb(null, {
            status: true,
            code: 1000,
            message: "Portal user updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (update portal user):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});



// --------------------------------------------------
// DELETE PORTAL USER (SOFT DELETE)
// --------------------------------------------------
responder.on('delete-portal-users', async (req, cb) => {
    try {
        const portal_user_uuid = req.portal_user_uuid;
        const deleted_by = req.body.deleted_by;

        if (!portal_user_uuid) {
            return cb(null, { status: false, code: 2001, error: "User UUID is required" });
        }

        // --------------------------------------------------
        // CHECK IF USER EXISTS
        // --------------------------------------------------
        const check = await pool.query(
            `SELECT portal_user_id FROM portal_users
             WHERE portal_user_uuid = $1 AND is_deleted = FALSE`,
            [portal_user_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "User not found" });
        }

        // --------------------------------------------------
        // SOFT DELETE PORTAL USER
        // --------------------------------------------------
        await pool.query(
            `
            UPDATE portal_users
            SET 
                is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
            WHERE portal_user_uuid = $2
            `,
            [deleted_by, portal_user_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Portal user deleted successfully"
        });

    } catch (err) {
        logger.error("Responder Error (delete portal user):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});



// --------------------------------------------------
// UPDATE USER STATUS (ACTIVE / INACTIVE)
// --------------------------------------------------
responder.on('status-portal-users', async (req, cb) => {
    try {
        const portal_user_uuid = req.portal_user_uuid;
        const modified_by = req.body.modified_by;

        if (!portal_user_uuid) {
            return cb(null, { status: false, code: 2001, error: "User UUID is required" });
        }

        // --------------------------------------------------
        // CHECK USER
        // --------------------------------------------------
        const check = await pool.query(
            `
            SELECT portal_user_id, is_active 
            FROM portal_users 
            WHERE portal_user_uuid = $1 AND is_deleted = FALSE
            `,
            [portal_user_uuid]
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
            UPDATE portal_users
            SET 
                is_active = $1,
                modified_by = $2,
                modified_at = NOW()
            WHERE portal_user_uuid = $3
            `,
            [newStatus, modified_by, portal_user_uuid]
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
// ADVANCED FILTER — PORTAL USERS
// --------------------------------------------------
responder.on('advancefilter-portal-users', async (req, cb) => {
    try {

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table: 'portal_users',
            alias: 'PU',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators ON PU.created_by = creators.user_uuid
                LEFT JOIN users updaters ON PU.modified_by = updaters.user_uuid
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'username', 'full_name', 'email', 'phone_number',
                'user_type', 'seller_id', 'buyer_id',
                'is_active', 'created_at', 'modified_at',
                'createdByName', 'updatedByName'
            ],

            /* ---------------- Custom Joined Fields ---------------- */
            customFields: {
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
                PU.is_deleted = FALSE
            `
        });

        return cb(null, {
            status: true,
            code: 1000,
            result
        });

    } catch (err) {
        console.error('[advancefilter-portal-users] error:', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});



// --------------------------------------------------
// CLONE PORTAL USER (NO ROLE CLONING)
// --------------------------------------------------
responder.on('clone-portal-users', async (req, cb) => {
    try {

        const { portal_user_uuid } = req;
        const { created_by } = req.body;

        if (!portal_user_uuid) {
            return cb(null, { status: false, code: 2001, error: "Portal user UUID is required" });
        }

        // -----------------------------------------
        // 1. Fetch existing user (without role_id)
        // -----------------------------------------
        const fetchSQL = `
            SELECT 
                username,
                email,
                phone_number,
                profile_icon,
                is_active
            FROM portal_users
            WHERE portal_user_uuid = $1 
              AND is_deleted = FALSE
        `;

        const original = await pool.query(fetchSQL, [portal_user_uuid]);

        if (original.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Portal user not found" });
        }

        const user = original.rows[0];

        // Default password for clone
        const password_hash = await bcrypt.hash("Password123", 10);

        // -----------------------------------------
        // 2. Insert cloned user (NO ROLE FIELD)
        // -----------------------------------------
        const cloneSQL = `
            INSERT INTO portal_users 
            (
                username, password_hash, email, phone_number, profile_icon,
                is_online, force_logout, is_active,
                created_by, created_at
            )
            VALUES 
            (
                $1, $2, NULL, NULL, $3,
                FALSE, FALSE, $4,
                $5, NOW()
            )
            RETURNING 
                portal_user_id, portal_user_uuid, username, email, phone_number, is_active
        `;

        const values = [
            user.username + " (Copy)",  // $1
            password_hash,              // $2
            user.profile_icon,          // $3
            user.is_active,             // $4
            created_by || null          // $5
        ];

        const cloneResult = await pool.query(cloneSQL, values);

        // -----------------------------------------
        // 3. Response
        // -----------------------------------------
        return cb(null, {
            status: true,
            code: 1000,
            message: "Portal user cloned successfully (role not copied)",
            data: cloneResult.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (clone-portal-users):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});








