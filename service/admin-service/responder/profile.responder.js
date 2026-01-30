require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// REDIS CONFIG
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

// COTE RESPONDER
const responder = new cote.Responder({
    name: 'profile responder',
    key: 'profile',
    redis: { host: redisHost, port: redisPort }
});

/* ======================================================
   CREATE PROFILE
====================================================== */
responder.on('create-profile', async (req, cb) => {
    try {
        const body = req.body || {};
        const { profile_name, created_by, assigned_to, description, access_rights } = body;

        if (!profile_name || !profile_name.trim()) {
            return cb(null, { status: false, code: 2001, error: "Profile name is required" });
        }

        // Duplicate check (case-insensitive)
        const check = await pool.query(
            `SELECT profile_id FROM profile 
             WHERE LOWER(profile_name) = LOWER($1)
               AND is_deleted = FALSE`,
            [profile_name.trim()]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: "Profile already exists" });
        }

        // Insert profile
        const insert = await pool.query(
            `INSERT INTO profile(
                profile_name,
                created_by,
                assigned_to,
                assigned_at,
                description
            )
            VALUES ($1,$2,$3,NOW(),$4)
            RETURNING *`,
            [profile_name.trim(), created_by, assigned_to, description]
        );

        const profile_id = insert.rows[0].profile_id;

        // Save privileges if provided
        if (access_rights && Array.isArray(access_rights)) {
            await savePrivileges(access_rights, profile_id, created_by);
        }

        return cb(null, {
            status: true,
            code: 1000,
            message: "Profile created successfully",
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (create-profile):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

/* ======================================================
   LIST PROFILES
====================================================== */
responder.on('list-profile', async (req, cb) => {
    try {
        const query = `
            SELECT 
                p.*,
                creators.username AS createdByName,
                updaters.username AS updatedByName
            FROM profile p
            LEFT JOIN users creators ON p.created_by = creators.user_uuid
            LEFT JOIN users updaters ON p.modified_by = updaters.user_uuid
            WHERE p.is_deleted = FALSE
            ORDER BY p.created_at ASC
        `;

        const result = await pool.query(query);

        return cb(null, {
            status: true,
            code: 1000,
            message: "Profile list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("Responder Error (list profile):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

/* ======================================================
   GET PROFILE BY ID
====================================================== */
responder.on('getById-profile', async (req, cb) => {
    try {
        const { profile_uuid } = req;

        const result = await pool.query(
            `SELECT 
                p.profile_id,
                p.profile_uuid,
                p.profile_name,
                p.created_by,
                p.assigned_to,
                p.assigned_at,
                p.description,
                pp.privilege_uuid,
                pp.module_type,
                pp.module_id,
                pp.fullgrantaccess,
                pp.createaccess,
                pp.editaccess,
                pp.deleteaccess,
                pp.listaccess,
                pp.viewaccess,
                pp.printaccess,
                pp.cloneaccess,
                pp.exportaccess
            FROM profile p
            LEFT JOIN profile_privilege pp 
                   ON p.profile_id = pp.profile_id
            WHERE p.profile_uuid = $1
              AND p.is_deleted = FALSE`,
            [profile_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Profile not found" });
        }

        // ---- Format response ----
        const profile = {
            profile_id: result.rows[0].profile_id,
            profile_uuid: result.rows[0].profile_uuid,
            profile_name: result.rows[0].profile_name,
            created_by: result.rows[0].created_by,
            assigned_to: result.rows[0].assigned_to,
            assigned_at: result.rows[0].assigned_at,
            description: result.rows[0].description,
            privileges: []
        };

        for (const row of result.rows) {
            if (row.privilege_uuid) {
                profile.privileges.push({
                    privilege_uuid: row.privilege_uuid,
                    module_type: row.module_type,
                    module_id: row.module_id,
                    fullgrantaccess: row.fullgrantaccess,
                    createaccess: row.createaccess,
                    editaccess: row.editaccess,
                    deleteaccess: row.deleteaccess,
                    listaccess: row.listaccess,
                    viewaccess: row.viewaccess,
                    printaccess: row.printaccess,
                    cloneaccess: row.cloneaccess,
                    exportaccess: row.exportaccess
                });
            }
        }

        return cb(null, {
            status: true,
            code: 1000,
            data: profile
        });

    } catch (err) {
        logger.error("Responder Error (getById-profile):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

/* ======================================================
   UPDATE PROFILE
====================================================== */
responder.on('update-profile', async (req, cb) => {
    try {
        const { profile_uuid, body } = req;

        if (!profile_uuid) {
            return cb(null, { status: false, code: 2001, error: "Profile ID is required" });
        }

        const {
            profile_name,
            modified_by,
            assigned_to,
            description,
            is_active,
            access_rights
        } = body;

        if (!profile_name || !profile_name.trim()) {
            return cb(null, { status: false, code: 2001, error: "Profile name is required" });
        }

        // ---- Duplicate check (case-insensitive, exclude current) ----
        const duplicate = await pool.query(
            `SELECT profile_uuid FROM profile
             WHERE LOWER(profile_name) = LOWER($1)
               AND is_deleted = FALSE
               AND profile_uuid != $2`,
            [profile_name.trim(), profile_uuid]
        );

        if (duplicate.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: "Profile already exists" });
        }

        // ---- Update profile ----
        const update = await pool.query(
            `UPDATE profile SET
                profile_name = $1,
                is_active = $2,
                modified_by = $3,
                modified_at = NOW(),
                description = $4
             WHERE profile_uuid = $5
             RETURNING *`,
            [
                profile_name.trim(),
                is_active || true,
                modified_by,
                description,
                profile_uuid
            ]
        );

        if (update.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Profile not found" });
        }

        // ---- Update privileges if provided ----
        if (access_rights && Array.isArray(access_rights)) {
            await savePrivileges(access_rights, update.rows[0].profile_id, modified_by);
        }

        return cb(null, {
            status: true,
            code: 1000,
            message: "Profile updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (update-profile):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


/* ======================================================
   DELETE PROFILE (SOFT DELETE + CASCADE)
====================================================== */
responder.on('delete-profile', async (req, cb) => {
    const client = await pool.connect();
    try {
        const { profile_uuid } = req;
        const { deleted_by } = req.body;

        await client.query('BEGIN');

        // ---- Soft delete profile ----
        const profileDelete = await client.query(
            `UPDATE profile SET
                is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
             WHERE profile_uuid = $2
               AND is_deleted = FALSE
             RETURNING profile_id`,
            [deleted_by, profile_uuid]
        );

        if (profileDelete.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                status: false,
                code: 2003,
                error: "Profile not found"
            });
        }

        const profile_id = profileDelete.rows[0].profile_id;

        // ---- Soft delete only active privileges ----
        await client.query(
            `UPDATE profile_privilege SET
                is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
             WHERE profile_id = $2
               AND is_deleted = FALSE`,
            [deleted_by, profile_id]
        );

        await client.query('COMMIT');

        return cb(null, {
            status: true,
            code: 1000,
            message: "Profile and privileges deleted successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (delete-profile):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    } finally {
        client.release();
    }
});



/* ======================================================
   STATUS CHANGE (PROFILE + PRIVILEGES)
====================================================== */
responder.on('status-profile', async (req, cb) => {
    const client = await pool.connect();
    try {
        const { profile_uuid } = req;
        const { is_active, modified_by } = req.body;

        if (typeof is_active !== 'boolean') {
            return cb(null, {
                status: false,
                code: 2001,
                error: "is_active must be true or false"
            });
        }

        await client.query('BEGIN');

        // ---- Update profile ----
        const profileUpdate = await client.query(
            `UPDATE profile
             SET is_active = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE profile_uuid = $3
               AND is_deleted = FALSE
             RETURNING profile_id`,
            [is_active, modified_by, profile_uuid]
        );

        if (profileUpdate.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                status: false,
                code: 2003,
                error: "Profile not found"
            });
        }

        const profile_id = profileUpdate.rows[0].profile_id;

        // ---- Update all active profile privileges ----
        await client.query(
            `UPDATE profile_privilege
             SET is_active = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE profile_id = $3
               AND is_deleted = FALSE`,
            [is_active, modified_by, profile_id]
        );

        await client.query('COMMIT');

        return cb(null, {
            status: true,
            code: 1000,
            message: "Profile and privileges status updated successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');   // ✅ fixed
        logger.error("Responder Error (status-profile):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    } finally {
        client.release();
    }
});


/* ======================================================
   ADVANCED FILTER — PROFILE
====================================================== */
responder.on('advancefilter-profile', async (req, cb) => {
    try {
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            table: 'profile',
            alias: 'P',
            defaultSort: 'created_at',

            joinSql: `
                LEFT JOIN users creators ON P.created_by = creators.user_uuid
                LEFT JOIN users updaters ON P.modified_by = updaters.user_uuid
            `,

            allowedFields: [
                'profile_name',
                'is_active',
                'assigned_to',
                'created_at',
                'modified_at',
                'description',
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
                P.is_deleted = FALSE
            `
        });

        return cb(null, {
            status: true,
            code: 1000,
            result
        });

    } catch (err) {
        logger.error("Advance Filter Profile Error:", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

/* ======================================================
// CREATE / UPDATE PRIVILEGES
====================================================== */
async function savePrivileges(privileges, profile_id, created_by) {
    const client = await pool.connect();
    try {

        if (!Array.isArray(privileges) || privileges.length === 0) {
            return { status: true, message: "No privileges to save" };
        }

        await client.query('BEGIN');
        const results = [];

        for (const item of privileges) {

            const {
                module_type,
                module_id,
                fullgrantaccess = false,
                createaccess = false,
                editaccess = false,
                deleteaccess = false,
                listaccess = false,
                viewaccess = false,
                printaccess = false,
                cloneaccess = false,
                exportaccess = false,
            } = item;

            if (!profile_id || !module_type || !module_id) {
                throw new Error("profile_id, module_type, module_id required");
            }

            // Check existing
            const exists = await client.query(
                `SELECT privilege_uuid 
                 FROM profile_privilege
                 WHERE profile_id=$1 AND module_type=$2 AND module_id=$3  AND is_deleted = FALSE`,
                [profile_id, module_type, module_id]
            );

            if (exists.rowCount === 0) {
                // INSERT
                const insert = await client.query(
                    `INSERT INTO profile_privilege(
                        profile_id, module_type, module_id,
                        fullgrantaccess, createaccess, editaccess,
                        deleteaccess, listaccess, viewaccess,
                        printaccess, cloneaccess, exportaccess,
                        created_by,assigned_to
                    )
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                    RETURNING *`,
                    [
                        profile_id, module_type, module_id,
                        fullgrantaccess, createaccess, editaccess,
                        deleteaccess, listaccess, viewaccess,
                        printaccess, cloneaccess, exportaccess,
                        created_by, created_by
                    ]
                );
                results.push(insert.rows[0]);

            } else {
                // UPDATE
                const update = await client.query(
                    `UPDATE profile_privilege SET
                        fullgrantaccess=$1,
                        createaccess=$2,
                        editaccess=$3,
                        deleteaccess=$4,
                        listaccess=$5,
                        viewaccess=$6,
                        printaccess=$7,
                        cloneaccess=$8,
                        exportaccess=$9,
                        modified_by=$10,
                        modified_at=NOW()
                     WHERE privilege_uuid=$11
                     RETURNING *`,
                    [
                        fullgrantaccess,
                        createaccess,
                        editaccess,
                        deleteaccess,
                        listaccess,
                        viewaccess,
                        printaccess,
                        cloneaccess,
                        exportaccess,
                        created_by,
                        exists.rows[0].privilege_uuid
                    ]
                );
                results.push(update.rows[0]);
            }
        }

        await client.query('COMMIT');

        return {
            status: true,
            message: "Privileges saved successfully",
            count: results.length,
            data: results
        };

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("savePrivileges Error:", err);
        throw err;  // <-- throw back to caller
    } finally {
        client.release();
    }
}




/* ======================================================
   LIST BY moduletypelist
====================================================== */
responder.on('moduletypelist', async (req, cb) => {
    try {
        const { module_type } = req;

        if (!module_type) {
            return cb(null, {
                status: false,
                code: 2001,
                error: "Module Type required"
            });
        }

        const result = await pool.query(
            `SELECT * FROM profile_privilege
             WHERE module_type = $1 
             AND is_deleted = FALSE
             ORDER BY created_at ASC`,
            [module_type]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: result.rowCount > 0
                ? "Privilege list fetched"
                : "No privileges found",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("moduletypelist Error:", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});