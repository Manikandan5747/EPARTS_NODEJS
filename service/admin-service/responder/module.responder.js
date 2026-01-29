require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');
const { createOrUpdateMisc, createOrUpdateMiscPrivileges } = require('@libs/common/common-util');
// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'module responder',
    key: 'module',
    redis: { host: redisHost, port: redisPort }
});

/* ======================================================
   CREATE MODULE
====================================================== */
responder.on('create-module', async (req, cb) => {
    try {
        const body = req.body || {};

        const {
            modulename,
            routename,
            parentmodid,
            isparent,
            issystemmenu,
            isreport,
            isfunctional,
            ismisc,
            iconname,
            menuorder,
            privilegekey,
            created_by, assigned_to
        } = body;

        if (!modulename || !modulename.trim()) {
            return cb(null, { status: false, code: 2001, error: "Module name is required" });
        }

        const moduleUpper = modulename.toUpperCase();
        const moduleLower = modulename.toLowerCase();

        // Duplicate Check
        const check = await pool.query(
            `SELECT module_id FROM module 
             WHERE (
                UPPER(modulename)= $1 
                OR LOWER(modulename)= $2 
                OR modulename = $3
             )
             AND is_deleted = FALSE`,
            [moduleUpper, moduleLower, modulename]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: "Module already exists" });
        }

        // Insert
        const insertQuery = `
            INSERT INTO module(
                modulename, routename, parentmodid, isparent, 
                issystemmenu, isreport, isfunctional, ismisc,
                iconname, menuorder, privilegekey, created_by,assigned_to
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            RETURNING *
        `;

        const insert = await pool.query(insertQuery, [
            modulename,
            routename,
            parentmodid,
            isparent,
            issystemmenu,
            isreport,
            isfunctional,
            ismisc,
            iconname,
            menuorder,
            privilegekey,
            created_by, assigned_to
        ]);

        if (ismisc) {
            let module_id = insert.rows[0].module_id;
            var miscItems = req.body.miscItems;
            let obj = { miscItems, module_id, created_by }
            createOrUpdateMisc(obj);
        }

        return cb(null, {
            status: true,
            code: 1000,
            message: "Module created successfully",
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (create module):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


/* ======================================================
   LIST MODULES
====================================================== */
responder.on('list-module', async (req, cb) => {
    try {

        const query = `
            SELECT 
                m.*,
                creators.username AS createdByName,
                updaters.username AS updatedByName
            FROM module m
            LEFT JOIN users creators ON m.created_by = creators.user_uuid
            LEFT JOIN users updaters ON m.modified_by = updaters.user_uuid
            WHERE m.is_deleted = FALSE
            ORDER BY m.created_at ASC
        `;

        const result = await pool.query(query);

        return cb(null, {
            status: true,
            code: 1000,
            message: "Module list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("Responder Error (list module):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


/* ======================================================
   GET MODULE BY ID
====================================================== */
responder.on('getById-module', async (req, cb) => {
    try {
        const { module_uuid } = req;

        const result = await pool.query(
            `SELECT * FROM module 
             WHERE module_uuid = $1 AND is_deleted = FALSE`,
            [module_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Module not found" });
        }

        const moduleData = result.rows[0];

        // Default misc array
        let miscList = [];

        // If ismisc = true → fetch miscellaneous_mapping
        if (moduleData.ismisc === true) {

            const miscResult = await pool.query(
                `SELECT misc_id,misc_uuid, misc_name, module_id, is_active
     FROM miscellaneous_mapping
     WHERE module_id = $1
     AND is_deleted = FALSE`,
                [moduleData.module_id]
            );

            miscList = miscResult.rows; // array of objects
        }

        let moduleDataObj = {
            module: moduleData,
            miscellaneous: miscList
        }

        // ---------- Final Response ----------
        return cb(null, { status: true, code: 1000, data: moduleDataObj });

    } catch (err) {
        logger.error("Responder Error (getById module):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


/* ======================================================
   UPDATE MODULE
====================================================== */
responder.on('update-module', async (req, cb) => {
    try {
        const { module_uuid, body } = req;

        if (!module_uuid) {
            return cb(null, { status: false, code: 2001, error: "Module ID is required" });
        }

        const {
            modulename,
            routename,
            parentmodid,
            isparent,
            issystemmenu,
            isreport,
            isfunctional,
            ismisc,
            iconname,
            menuorder,
            privilegekey,
            modified_by,
            is_active, assigned_to
        } = body;

        if (!modulename || !modulename.trim()) {
            return cb(null, { status: false, code: 2001, error: "Module name is required" });
        }

        const moduleUpper = modulename.toUpperCase();
        const moduleLower = modulename.toLowerCase();

        // Duplicate Check excluding current
        const duplicate = await pool.query(
            `SELECT module_uuid FROM module
             WHERE (
                UPPER(modulename)= $1 
                OR LOWER(modulename)= $2 
                OR modulename = $3
             )
             AND is_deleted = FALSE
             AND module_uuid != $4`,
            [moduleUpper, moduleLower, modulename, module_uuid]
        );

        if (duplicate.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: "Module already exists" });
        }

        const update = await pool.query(
            `UPDATE module SET
                modulename=$1,
                routename=$2,
                parentmodid=$3,
                isparent=$4,
                issystemmenu=$5,
                isreport=$6,
                isfunctional=$7,
                ismisc=$8,
                iconname=$9,
                menuorder=$10,
                privilegekey=$11,
                is_active=$12,
                modified_by=$13,
                modified_at=NOW()
             WHERE module_uuid=$14
             RETURNING *`,
            [
                modulename,
                routename,
                parentmodid,
                isparent,
                issystemmenu,
                isreport,
                isfunctional,
                ismisc,
                iconname,
                menuorder,
                privilegekey,
                is_active,
                modified_by,
                module_uuid
            ]
        );

        if (ismisc) {
            let module_id = update.rows[0].module_id;
            var miscItems = req.body.miscItems;
            let obj = { miscItems, module_id, modified_by }
            createOrUpdateMisc(obj);
        }

        return cb(null, {
            status: true,
            code: 1000,
            message: "Module updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (update module):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


/* ======================================================
   DELETE MODULE (SOFT DELETE)
====================================================== */
responder.on('delete-module', async (req, cb) => {
    try {
        const module_uuid = req.module_uuid;
        const deleted_by = req.body.deleted_by;

        const check = await pool.query(
            `SELECT module_id FROM module 
             WHERE module_uuid = $1 AND is_deleted = FALSE`,
            [module_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Module not found" });
        }

        await pool.query(
            `UPDATE module SET
                is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
             WHERE module_uuid = $2`,
            [deleted_by, module_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Module deleted successfully"
        });

    } catch (err) {
        logger.error("Responder Error (delete module):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


/* ======================================================
   STATUS CHANGE
====================================================== */
responder.on('status-module', async (req, cb) => {
    try {
        const module_uuid = req.module_uuid;
        const modified_by = req.body.modified_by;
        const { is_active } = req.body;

        const check = await pool.query(
            `SELECT module_id FROM module 
             WHERE module_uuid = $1 AND is_deleted = FALSE`,
            [module_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Module not found" });
        }

        await pool.query(
            `UPDATE module
             SET is_active = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE module_uuid = $3`,
            [is_active, modified_by, module_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Module status updated successfully"
        });

    } catch (err) {
        logger.error("Responder Error (status module):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


/* ======================================================
   ADVANCED FILTER — MODULE
====================================================== */
responder.on('advancefilter-module', async (req, cb) => {
    try {
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            table: 'module',
            alias: 'M',
            defaultSort: 'created_at',

            joinSql: `
                LEFT JOIN users creators ON M.created_by = creators.user_uuid
                LEFT JOIN users updaters ON M.modified_by = updaters.user_uuid
            `,

            allowedFields: [
                'modulename',
                'routename',
                'isparent',
                'issystemmenu',
                'isreport',
                'isfunctional',
                'ismisc',
                'menuorder',
                'is_active',
                'created_at',
                'modified_at',
                'createdByName',
                'updatedByName'
            ],

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

            baseWhere: `
                M.is_deleted = FALSE
            `
        });

        return cb(null, {
            status: true,
            code: 1000,
            result
        });

    } catch (err) {
        logger.error("Advance Filter Module Error:", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// responders/miscellaneousPrivilegesResponder.js
// responders/miscellaneousPrivilegesResponder.js

responder.on('create-or-update-misc-privileges', async (req, cb) => {

    const { miscItems, module_id, role_id } = req.data;
    const created_by = req.data.created_by || req.userid;
    const assigned_to = req.data.assigned_to || null;
    const timestamp = new Date();

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const operations = miscItems.map(item => {

            const access = typeof item.access === 'boolean' ? item.access : !!item.access;
            const is_active = typeof item.is_active === 'boolean' ? item.is_active : true;

            // ---------- UPDATE ----------
            if (item.misc_privilege_id) {
                return client.query(
                    `UPDATE miscellaneous_privileges
           SET module_id = $1,
               role_id = $2,
               misc_id = $3,
               access = $4,
               is_active = $5,
               modified_at = $6,
               modified_by = $7
           WHERE misc_privilege_id = $8
           AND is_deleted = FALSE`,
                    [
                        module_id,
                        role_id,
                        item.misc_id,
                        access,
                        is_active,
                        timestamp,
                        created_by,
                        item.misc_privilege_id
                    ]
                );
            }

            // ---------- INSERT ----------
            return client.query(
                `INSERT INTO miscellaneous_privileges
         (misc_id, module_id, role_id, access, is_active, assigned_to,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [
                    item.misc_id,
                    module_id,
                    role_id,
                    access,
                    is_active,
                    created_by,
                    created_by
                ]
            );
        });

        await Promise.all(operations);
        await client.query('COMMIT');

        return cb(null, {
            success: true, code: 1000,
            message: "Miscellaneous privileges processed successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Responder Error:", err);

        return cb(null, {
            success: false, code: 2004,
            message: "Error processing miscellaneous privileges",
            error: err.message
        });

    } finally {
        client.release();
    }
});


/* ======================================================
   LIST MODULES WITH PRIVILEGE FILTER
   Show only modules where any access is TRUE
====================================================== */

// s
//     try {

//         // (Optional) If profile_id comes from request
//         const { profile_id } = req;

//         const query = `
//             SELECT 
//                 m.*,
//                 pp.*,
//                 creators.username AS createdByName,
//                 updaters.username AS updatedByName
//             FROM module m
//             LEFT JOIN users creators 
//                    ON m.created_by = creators.user_uuid
//             LEFT JOIN users updaters 
//                    ON m.modified_by = updaters.user_uuid
//             LEFT JOIN profile_privilege pp 
//                    ON m.module_id = pp.module_id
//                   AND pp.is_deleted = false
//                   AND pp.is_active = true
//                   ${profile_id ? 'AND pp.profile_id = $1' : ''}

//             WHERE m.is_deleted = false 
//               AND m.isreport = false

//               -- ✅ Only modules having at least one access = true
//               AND true IN (
//                    pp.fullgrantaccess,
//                    pp.createaccess,
//                    pp.editaccess,
//                    pp.deleteaccess,
//                    pp.listaccess,
//                    pp.viewaccess,
//                    pp.printaccess,
//                    pp.cloneaccess
//               )

//             ORDER BY m.created_at ASC
//         `;

//         const params = profile_id ? [profile_id] : [];

//         const result = await pool.query(query, params);

//         return cb(null, {
//             status: true,
//             code: 1000,
//             message: "Module list fetched successfully",
//             count: result.rowCount,
//             data: result.rows
//         });

//     } catch (err) {
//         logger.error("Responder Error (list-module):", err);
//         return cb(null, { 
//             status: false, 
//             code: 2004, 
//             error: err.message 
//         });
//     }
// });



/* ======================================================
   LIST MODULES BASED ON ROLE → PROFILE → PRIVILEGES
====================================================== */

responder.on('side-menu-module', async (req, cb) => {
    try {

        const { role_uuid } = req;  // role_id from request

        const roleResult = await pool.query(
            `SELECT role_id,role_uuid,role_name,hierarchy_level, dept_id,is_deleted,deleted_at,deleted_by, cmp_id, is_active
             FROM user_role
             WHERE role_uuid = $1 AND is_deleted = FALSE`,
            [role_uuid]
        );

        if (roleResult.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Role not found" });
        }

        const role_id = roleResult.rows[0].role_id;

        const query = `
            SELECT DISTINCT
                m.*,
                pp.*,
                creators.username AS createdByName,
                updaters.username AS updatedByName

            FROM role_profile_mapping rpm

            -- role → profile
            JOIN profile_privilege pp 
                 ON rpm.profile_id = pp.profile_id
                AND pp.is_deleted = false
                AND pp.is_active = true

            -- privilege → module
            JOIN module m 
                 ON pp.module_id = m.module_id
                AND m.is_deleted = false
                AND m.isreport = false

            -- user names
            LEFT JOIN users creators 
                   ON m.created_by = creators.user_uuid
            LEFT JOIN users updaters 
                   ON m.modified_by = updaters.user_uuid

            WHERE rpm.role_id = $1
              AND rpm.is_deleted = false
              AND rpm.is_active = true

              -- ✅ At least one privilege must be true
              AND true IN (
                   pp.fullgrantaccess,
                   pp.createaccess,
                   pp.editaccess,
                   pp.deleteaccess,
                   pp.listaccess,
                   pp.viewaccess,
                   pp.printaccess,
                   pp.cloneaccess
              )

            ORDER BY m.created_at ASC
        `;

        const result = await pool.query(query, [role_id]);

        return cb(null, {
            status: true,
            code: 1000,
            message: "Module list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("Responder Error (list-module):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});






