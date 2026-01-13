require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'usertype responder',
    key: 'usertype',
    redis: { host: redisHost, port: redisPort }
});



// --------------------------------------------------
// CREATE USER TYPE (Corrected)
// --------------------------------------------------
responder.on('create-usertype', async (req, cb) => {
    try {
        const {
            code,
            description,
            created_by,
            assigned_to
        } = req.body;

        const name = req.body?.name?.trim() || null;

        if (!name) {
            return cb(null, { status: false, code: 2001, error: "User Type name is required" });
        }

        const Upper = name.toUpperCase();
        const Lower = name.toLowerCase();

        // --------------------------------------------------
        // CHECK FOR DUPLICATE USER TYPE NAME (Corrected table + columns)
        // --------------------------------------------------
        const checkQuery = {
            text: `
                SELECT user_type_id FROM user_types 
                WHERE (
                    UPPER(name) = $1 
                    OR LOWER(name) = $2 
                    OR name = $3
                ) AND is_deleted = FALSE
            `,
            values: [Upper, Lower, name]
        };

        const check = await pool.query(checkQuery);

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: "User Type name already exists" });
        }

        // --------------------------------------------------
        // INSERT NEW USER TYPE (UUID auto-generated)
        // --------------------------------------------------
        const insert = await pool.query(
            `INSERT INTO user_types 
                (name, code, description, created_by, assigned_to)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING user_type_id, name, code, description, is_active`,
            [name, code, description, created_by, assigned_to]
        );

        const result = {
            status: true, code: 1000,
            message: "User Type created successfully",
            data: insert.rows[0]
        };

        return cb(null, result);

    } catch (err) {
        logger.error("Responder Error (create User Type ):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// LIST USER TYPE
// --------------------------------------------------
responder.on('list-usertype', async (req, cb) => {
    try {

        const query = `
            SELECT 
                r.user_type_id,
                r.user_type_uuid,
                r.name,
                r.code,
                r.description,
                r.is_active,
                r.created_at,
                r.created_by,
                r.modified_at,
                r.modified_by,
                r.deleted_at,
                r.deleted_by,
                r.is_deleted,
                creators.username AS createdByName,
                updaters.username AS updatedByName
            FROM 
                user_types r
            LEFT JOIN 
                users creators 
                ON r.created_by = creators.user_uuid
            LEFT JOIN 
                users updaters 
                ON r.modified_by = updaters.user_uuid
            WHERE 
                r.is_deleted = FALSE
            ORDER BY 
                r.created_at ASC
        `;

        const result = await pool.query(query);

        return cb(null, {
            status: true, code: 1000,
            message: "User Type list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("Responder Error (list User Type ):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// GET USER TYPE BY ID
// --------------------------------------------------
responder.on('getById-usertype', async (req, cb) => {
    try {
        const { user_type_uuid } = req;

        const result = await pool.query(
            `SELECT user_type_id,user_type_uuid,name, code,is_deleted,deleted_at,deleted_by, description, is_active
             FROM user_types
             WHERE user_type_uuid = $1 AND is_deleted = FALSE`,
            [user_type_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "User Type not found" });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        logger.error("Responder Error (getById User Type):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// UPDATE USER TYPE
// --------------------------------------------------
responder.on('update-usertype', async (req, cb) => {
    try {
        const { user_type_uuid, body } = req;
        const { name, code, description, modified_by,is_active } = body;

        if (!user_type_uuid) {
            return cb(null, { status: false, code: 2001, error: "User Type ID is required" });
        }

        if (!name || !name.trim()) {
            return cb(null, { status: false, code: 2001, error: "User Type name is required" });
        }

        const roleName = name.trim();
        const roleUpper = roleName.toUpperCase();
        const roleLower = roleName.toLowerCase();

        // --------------------------------------------------
        // CHECK FOR DUPLICATE (excluding this User Type)
        // --------------------------------------------------
        const checkQuery = {
            text: `
                SELECT user_type_uuid  FROM user_types 
                WHERE (
                    UPPER(name) = $1
                    OR LOWER(name) = $2
                    OR name = $3
                )
                AND is_deleted = FALSE
                AND user_type_uuid  != $4
            `,
            values: [roleUpper, roleLower, roleName, user_type_uuid]
        };

        const duplicate = await pool.query(checkQuery);

        if (duplicate.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: "User Type name already exists" });
        }

        // --------------------------------------------------
        // UPDATE USER TYPE
        // --------------------------------------------------
        const updateQuery = `
            UPDATE user_types
            SET 
                name = $1,
                code = $2,
                description = $3,
                modified_by = $4,
                modified_at = NOW(),
                is_active= $5
            WHERE user_type_uuid = $6
            RETURNING *
        `;

        const update = await pool.query(updateQuery, [
            roleName,
            code,
            description,
            modified_by,
            is_active,
            user_type_uuid
        ]);

        return cb(null, {
            status: true, code: 1000,
            message: "User Type updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (update User Type):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// DELETE USER (SOFT DELETE) IS_DELETE STATUS CHANGES ONLY
// --------------------------------------------------
responder.on('delete-usertype', async (req, cb) => {
    try {
        const user_type_uuid = req.user_type_uuid;
        const deleted_by = req.body.deleted_by;

        const check = await pool.query(
            `SELECT user_type_id FROM user_types WHERE user_type_uuid = $1 AND is_deleted = FALSE`,
            [user_type_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "User Type not found" });
        }

        await pool.query(
            `UPDATE user_types
             SET is_deleted = TRUE,is_active = false,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE user_type_uuid = $2`,
            [deleted_by, user_type_uuid]
        );

        return cb(null, {
            status: true, code: 1000,
            message: "User Type deleted successfully"
        });

    } catch (err) {
        logger.error("Responder Error (delete User Type):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// UPDATE USER TYPE STATUS (ACTIVE / INACTIVE)
// --------------------------------------------------
responder.on('status-usertype', async (req, cb) => {
    try {
        const user_type_uuid = req.user_type_uuid;
        const modified_by = req.body.modified_by;

        const check = await pool.query(
            `SELECT user_type_id FROM user_types WHERE user_type_uuid = $1 AND is_active = TRUE`,
            [user_type_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "User Type not found" });
        }

        await pool.query(
            `UPDATE user_types
             SET is_active = false,
                 modified_by = $1,
                 modified_at = NOW()
             WHERE user_type_uuid = $2`,
            [modified_by, user_type_uuid]
        );

        return cb(null, {
            status: true, code: 1000,
            message: "User Type Updated successfully"
        });

    } catch (err) {
        logger.error("Responder Error (delete User Type):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// ADVANCED FILTER — USERS TYPE
// --------------------------------------------------
responder.on('advancefilter-usertype', async (req, cb) => {
    try {
        /* ----------------- RUN DYNAMIC QUERY ----------------- */
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            table: 'user_types',
            alias: 'UR',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators ON UR.created_by = creators.user_uuid
                LEFT JOIN users updaters ON UR.modified_by = updaters.user_uuid
            `,

            /* -------------- Fields user can search/sort -------------- */
            allowedFields: [
                'name', 'code', 'description',
                'is_active', 'created_at', 'modified_at',
                'createdByName', 'updatedByName'
            ],

            /* -------- Custom joined fields (virtual fields) -------- */
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

            /* -------------- ALWAYS FIXED WHERE CONDITION -------------- */
            baseWhere: `
                UR.is_deleted = FALSE
            `
        });

        /* ----------------- SEND RESULT ----------------- */
        // res.json(result);

        return cb(null, {
            status: true, code: 1000,
            result
        });

    } catch (err) {
        console.error('[userroleReportNew] error:', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// CLONE USER TYPE
// --------------------------------------------------
responder.on('clone-usertype', async (req, cb) => {
    try {
        const { user_type_uuid } = req.user_type_uuid;
        const { created_by } = req.body;   // user who is cloning (optional)

        // 1. Fetch existing User Type
        const fetchSQL = `
            SELECT name, code, description, is_active
            FROM user_types
            WHERE user_type_uuid = $1 AND is_deleted = FALSE;
        `;

        const { rows } = await pool.query(fetchSQL, [user_type_uuid]);

        if (!rows.length) {
            return res.status(404).json({ message: "Original User Type not found", code: 2003 });
        }

        const UserType = rows[0];

        // 2. Insert new cloned UserType
        const cloneSQL = `
            INSERT INTO user_types 
            (name, code, description, is_active, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *;
        `;

        const values = [
            UserType.name + " (Copy)",  // Optional rename
            UserType.code,
            UserType.description,
            UserType.is_active,
            created_by || null
        ];

        const { rows: cloned } = await pool.query(cloneSQL, values);

        return cb(null, {
            status: true, code: 1000,
            message: "User Type cloned successfully",
            data: cloned[0]
        });

    } catch (err) {
        console.error("clone UserType error:", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});







