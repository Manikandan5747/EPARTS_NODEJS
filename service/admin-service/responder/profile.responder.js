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
        const { profile_name, created_by, assigned_to } = body;

        if (!profile_name || !profile_name.trim()) {
            return cb(null, { status: false, code: 2001, error: "Profile name is required" });
        }

        const nameUpper = profile_name.toUpperCase();
        const nameLower = profile_name.toLowerCase();

        // Duplicate check
        const check = await pool.query(
            `SELECT profile_id FROM profile 
             WHERE (
                UPPER(profile_name) = $1
                OR LOWER(profile_name) = $2
                OR profile_name = $3
             )
             AND is_deleted = FALSE`,
            [nameUpper, nameLower, profile_name]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: "Profile already exists" });
        }

        const insert = await pool.query(
            `INSERT INTO profile(
                profile_name,
                created_by,
                assigned_to,
                assigned_at
            )
            VALUES ($1,$2,$3, NOW())
            RETURNING *`,
            [profile_name, created_by, assigned_to]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Profile created successfully",
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (create profile):", err);
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
            `SELECT * FROM profile 
             WHERE profile_uuid = $1 AND is_deleted = FALSE`,
            [profile_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Profile not found" });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        logger.error("Responder Error (getById profile):", err);
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
            is_active
        } = body;

        if (!profile_name || !profile_name.trim()) {
            return cb(null, { status: false, code: 2001, error: "Profile name is required" });
        }

        const upper = profile_name.toUpperCase();
        const lower = profile_name.toLowerCase();

        // Duplicate validation excluding current
        const duplicate = await pool.query(
            `SELECT profile_uuid FROM profile
             WHERE (
                UPPER(profile_name)= $1
                OR LOWER(profile_name)= $2
                OR profile_name = $3
             )
             AND is_deleted = FALSE
             AND profile_uuid != $4`,
            [upper, lower, profile_name, profile_uuid]
        );

        if (duplicate.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: "Profile already exists" });
        }

        const update = await pool.query(
            `UPDATE profile SET
                profile_name = $1,
                assigned_to = $2,
                is_active = $3,
                modified_by = $4,
                modified_at = NOW()
             WHERE profile_uuid = $5
             RETURNING *`,
            [profile_name, assigned_to, is_active, modified_by, profile_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Profile updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (update profile):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


/* ======================================================
   DELETE PROFILE (SOFT DELETE)
====================================================== */
responder.on('delete-profile', async (req, cb) => {
    try {
        const profile_uuid = req.profile_uuid;
        const deleted_by = req.body.deleted_by;

        const check = await pool.query(
            `SELECT profile_id FROM profile 
             WHERE profile_uuid = $1 AND is_deleted = FALSE`,
            [profile_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Profile not found" });
        }

        await pool.query(
            `UPDATE profile SET
                is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
             WHERE profile_uuid = $2`,
            [deleted_by, profile_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Profile deleted successfully"
        });

    } catch (err) {
        logger.error("Responder Error (delete profile):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


/* ======================================================
   STATUS CHANGE
====================================================== */
responder.on('status-profile', async (req, cb) => {
    try {
        const profile_uuid = req.profile_uuid;
        const modified_by = req.body.modified_by;
        const { is_active } = req.body;

        const check = await pool.query(
            `SELECT profile_id FROM profile 
             WHERE profile_uuid = $1 AND is_deleted = FALSE`,
            [profile_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: "Profile not found" });
        }

        await pool.query(
            `UPDATE profile
             SET is_active = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE profile_uuid = $3`,
            [is_active, modified_by, profile_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Profile status updated successfully"
        });

    } catch (err) {
        logger.error("Responder Error (status profile):", err);
        return cb(null, { status: false, code: 2004, error: err.message });
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
