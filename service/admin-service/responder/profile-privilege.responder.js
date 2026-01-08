require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');

// REDIS CONFIG
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'profile_privilege responder',
    key: 'profile_privilege',
    redis: { host: redisHost, port: redisPort }
});


/* ======================================================
   CREATE + UPDATE (SAME API)
====================================================== */
responder.on('save-profile_privilege', async (req, cb) => {
    try {
        const body = req.body || {};
        const {
            privilege_uuid,
            profile_id,
            module_type,
            module_id,
            fullgrantaccess,
            createaccess,
            editaccess,
            deleteaccess,
            listaccess,
            viewaccess,
            printaccess,
            cloneaccess,
            created_by,
            modified_by
        } = body;

        if (!profile_id)
            return cb(null, { status: false, code: 2001, error: "Profile ID required" });

        if (!module_type)
            return cb(null, { status: false, code: 2001, error: "Module Type required" });

        if (!module_id)
            return cb(null, { status: false, code: 2001, error: "Module ID required" });


        /* ---------------- CREATE ---------------- */
        if (!privilege_uuid) {

            // Duplicate check
            const exists = await pool.query(
                `SELECT privilege_id FROM profile_privilege 
                 WHERE profile_id=$1 AND module_id=$2 AND module_type=$3 
                 AND is_deleted=FALSE`,
                [profile_id, module_id, module_type]
            );

            if (exists.rowCount > 0)
                return cb(null, { status: false, code: 2002, error: "Privilege already exists" });

            const insert = await pool.query(
                `INSERT INTO profile_privilege(
                    profile_id, module_type, module_id,
                    fullgrantaccess, createaccess, editaccess,
                    deleteaccess, listaccess, viewaccess,
                    printaccess, cloneaccess, created_by
                )
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                RETURNING *`,
                [
                    profile_id,
                    module_type,
                    module_id,
                    fullgrantaccess,
                    createaccess,
                    editaccess,
                    deleteaccess,
                    listaccess,
                    viewaccess,
                    printaccess,
                    cloneaccess,
                    created_by
                ]
            );

            return cb(null, {
                status: true,
                code: 1000,
                message: "Privilege created successfully",
                data: insert.rows[0]
            });
        }


        /* ---------------- UPDATE ---------------- */
        const duplicate = await pool.query(
            `SELECT privilege_uuid FROM profile_privilege
             WHERE profile_id=$1 AND module_id=$2 AND module_type=$3
             AND is_deleted=FALSE AND privilege_uuid != $4`,
            [profile_id, module_id, module_type, privilege_uuid]
        );

        if (duplicate.rowCount > 0)
            return cb(null, { status: false, code: 2002, error: "Privilege already exists" });

        const update = await pool.query(
            `UPDATE profile_privilege SET
                profile_id=$1,
                module_type=$2,
                module_id=$3,
                fullgrantaccess=$4,
                createaccess=$5,
                editaccess=$6,
                deleteaccess=$7,
                listaccess=$8,
                viewaccess=$9,
                printaccess=$10,
                cloneaccess=$11,
                modified_by=$12,
                modified_at=NOW()
             WHERE privilege_uuid=$13
             RETURNING *`,
            [
                profile_id,
                module_type,
                module_id,
                fullgrantaccess,
                createaccess,
                editaccess,
                deleteaccess,
                listaccess,
                viewaccess,
                printaccess,
                cloneaccess,
                modified_by,
                privilege_uuid
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Privilege updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        logger.error("save-profile_privilege Error:", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});



/* ======================================================
   LIST ALL PRIVILEGES
====================================================== */
responder.on('list-profile_privilege', async (req, cb) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.*,
                u1.username AS createdByName,
                u2.username AS updatedByName
            FROM profile_privilege p
            LEFT JOIN users u1 ON p.created_by = u1.user_uuid
            LEFT JOIN users u2 ON p.modified_by = u2.user_uuid
            WHERE p.is_deleted = FALSE
            ORDER BY p.created_at ASC
        `);

        return cb(null, {
            status: true,
            code: 1000,
            message: "Privilege list fetched",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("list-profile_privilege Error:", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});



/* ======================================================
   LIST BY PROFILE ID
====================================================== */
responder.on('listByProfile-profile_privilege', async (req, cb) => {
    try {
        const { profile_id } = req;

        if (!profile_id)
            return cb(null, { status: false, code: 2001, error: "Profile ID required" });

        const result = await pool.query(
            `SELECT * FROM profile_privilege
             WHERE profile_id=$1 AND is_deleted=FALSE
             ORDER BY created_at ASC`,
            [profile_id]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Privilege list fetched",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("listByProfile-profile_privilege Error:", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});
