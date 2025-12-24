require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'roles responder',
    key: 'roles',
    redis: { host: redisHost, port: redisPort }
});


// --------------------------------------------------
// CREATE ROLE 
// --------------------------------------------------
responder.on('create-role', async (req, cb) => {
    try {
        const {
            dept_id,
            cmp_id,
            created_by,hierarchy_level
        } = req.body;

        const role_name = req.body?.role_name?.trim() || null;

        if (!role_name) {
            return cb(null, { status: false, code: 2001, error: "Role name is required" });
        }

        const roleUpper = role_name.toUpperCase();
        const roleLower = role_name.toLowerCase();

        // --------------------------------------------------
        // CHECK FOR DUPLICATE ROLE NAME (Corrected table + columns)
        // --------------------------------------------------
        const checkQuery = {
            text: `
                    SELECT role_id FROM user_role 
                    WHERE (
                        UPPER(role_name) = $1 
                        OR LOWER(role_name) = $2 
                        OR role_name = $3
                    ) AND is_deleted = FALSE
                `,
            values: [roleUpper, roleLower, role_name]
        };

        const check = await pool.query(checkQuery);

        // CHECK FOR DUPLICATE
        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: "Role name already exists" });
        }


        // --------------------------------------------------
        // INSERT NEW ROLE (UUID auto-generated)
        // --------------------------------------------------
        const insert = await pool.query(
            `INSERT INTO user_role 
                    (role_name, dept_id, cmp_id,hierarchy_level, created_by)
                VALUES ($1, $2, $3, $4,$5)`,
            [role_name, dept_id, cmp_id,hierarchy_level, created_by]
        );

        const result = {
            status: true, code: 1000,
            message: "Role created successfully",
            data: insert.rows[0]
        };

        return cb(null, result);

    } catch (err) {
        logger.error("Responder Error (create role):", err);

        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// LIST ROLES 
// --------------------------------------------------
responder.on('list-role', async (req, cb) => {
    try {

        const query = `
            SELECT 
                r.role_id,
                r.role_uuid,
                r.role_name,
                r.hierarchy_level,
                r.dept_id,
                r.cmp_id,
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
                user_role r
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
            message: "Role list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("Responder Error (list roles):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// LIST ROLES BY ID
// --------------------------------------------------
responder.on('getById-role', async (req, cb) => {

    try {
        const { role_uuid } = req;

        const result = await pool.query(
            `SELECT role_id,role_uuid,role_name,hierarchy_level, dept_id,is_deleted,deleted_at,deleted_by, cmp_id, is_active
             FROM user_role
             WHERE role_uuid = $1 AND is_deleted = FALSE`,
            [role_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Role not found" });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        logger.error("Responder Error (getById role):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// UPDATE ROLE
// --------------------------------------------------
responder.on('update-role', async (req, cb) => {
    try {
        const { role_uuid, body } = req;
        const { role_name, dept_id, cmp_id, modified_by,hierarchy_level,is_active } = body;

        if (!role_uuid) {
            return cb(null, { status: false, code: 2001, error: "Role ID is required" });
        }

        if (!role_name || !role_name.trim()) {
            return cb(null, { status: false, code: 2001, error: "Role name is required" });
        }

        const roleName = role_name.trim();
        const roleUpper = roleName.toUpperCase();
        const roleLower = roleName.toLowerCase();

        // --------------------------------------------------
        // CHECK FOR DUPLICATE (excluding this role)
        // --------------------------------------------------
        const checkQuery = {
            text: `
                SELECT role_uuid  FROM user_role 
                WHERE (
                    UPPER(role_name) = $1
                    OR LOWER(role_name) = $2
                    OR role_name = $3
                )
                AND is_deleted = FALSE
                AND role_uuid  != $4
            `,
            values: [roleUpper, roleLower, roleName, role_uuid]
        };

        const duplicate = await pool.query(checkQuery);

        if (duplicate.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: "Role name already exists" });
        }

        // --------------------------------------------------
        // UPDATE ROLE
        // --------------------------------------------------
        const updateQuery = `
            UPDATE user_role
            SET 
                role_name = $1,
                dept_id = $2,
                cmp_id = $3,
                modified_by = $4,
                hierarchy_level = $5,
                is_active = $6,
                modified_at = NOW()
            WHERE role_uuid = $7
            RETURNING *
        `;

        const update = await pool.query(updateQuery, [
            roleName,
            dept_id,
            cmp_id,
            modified_by,
            hierarchy_level,
            is_active,
            role_uuid
        ]);

        return cb(null, {
            status: true, code: 1000,
            message: "Role updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (update role):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// DELETE ROLE (SOFT DELETE) IS_DELETE STATUS CHANGES ONLY
// --------------------------------------------------
responder.on('delete-role', async (req, cb) => {
    try {
        const role_uuid = req.role_uuid;
        const deleted_by = req.body.deleted_by;

        const check = await pool.query(
            `SELECT role_id FROM user_role WHERE role_uuid = $1 AND is_deleted = FALSE`,
            [role_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Role not found" });
        }

        await pool.query(
            `UPDATE user_role
             SET is_deleted = TRUE,is_active = false,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE role_uuid = $2`,
            [deleted_by, role_uuid]
        );

        return cb(null, {
            status: true, code: 1000,
            message: "Role deleted successfully"
        });

    } catch (err) {
        logger.error("Responder Error (delete role):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});



// --------------------------------------------------
// UPDATE ROLE STATUS (ACTIVE / INACTIVE)
// --------------------------------------------------
responder.on('status-role', async (req, cb) => {
    try {
        const role_uuid = req.role_uuid;
        const modified_by = req.body.modified_by;

        const check = await pool.query(
            `SELECT role_id FROM user_role WHERE role_uuid = $1 AND is_active = TRUE`,
            [role_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Role not found" });
        }

        await pool.query(
            `UPDATE user_role
             SET is_active = false,
                 modified_by = $1,
                 modified_at = NOW()
             WHERE role_uuid = $2`,
            [modified_by, role_uuid]
        );

        return cb(null, {
            status: true, code: 1000,
            message: "Role Updated successfully"
        });

    } catch (err) {
        logger.error("Responder Error (delete role):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// ADVANCED FILTER — ROLESS
// --------------------------------------------------
responder.on('advancefilter-role', async (req, cb) => {
    try {
        /* ----------------- RUN DYNAMIC QUERY ----------------- */
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            table: 'user_role',
            alias: 'UR',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators ON UR.created_by = creators.user_uuid
                LEFT JOIN users updaters ON UR.modified_by = updaters.user_uuid
            `,

            /* -------------- Fields user can search/sort -------------- */
            allowedFields: [
                'role_name', 'dept_id', 'cmp_id','hierarchy_level',
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
        return cb(null, { code: 2004, status: false, error: err.message });
    }
});


// --------------------------------------------------
// CLONE ROLES
// --------------------------------------------------
responder.on('clone-role', async (req, cb) => {
    try {
        const { role_uuid } = req.role_uuid;
        const { created_by } = req.body;   // user who is cloning (optional)

        // 1. Fetch existing role
        const fetchSQL = `
            SELECT role_name, dept_id, cmp_id,hierarchy_level, is_active
            FROM user_role
            WHERE role_uuid = $1 AND is_deleted = FALSE;
        `;

        const { rows } = await pool.query(fetchSQL, [role_uuid]);

        if (!rows.length) {
            return cb(null, { status: false, code: 2003, error: "Original Role not found" });
        }

        const role = rows[0];

        // 2. Insert new cloned role
        const cloneSQL = `
            INSERT INTO user_role 
            (role_name, dept_id, cmp_id, is_active,hierarchy_level, created_by)
            VALUES ($1, $2, $3, $4, $5,$6)
            RETURNING *;
        `;

        const values = [
            role.role_name + " (Copy)",  // Optional rename
            role.dept_id,
            role.cmp_id,
            role.is_active,
            role.hierarchy_level,
            created_by || null
        ];

        const { rows: cloned } = await pool.query(cloneSQL, values);

        return cb(null, {
            status: true, code: 1000,
            message: "Role cloned successfully",
            data: cloned[0]
        });

    } catch (err) {
        console.error("cloneRole error:", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});













