require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'cms_social_media_info responder',
    key: 'cms_social_media_info',
    redis: { host: redisHost, port: redisPort }
});

// --------------------------------------------------
// CREATE 
// --------------------------------------------------
responder.on('create-cmssocialmediainfo', async (req, cb) => {
    try {
        const {
            link,
            icon,
            created_by, 
            assigned_to
        } = req.body;

        if (!link || !link.trim()) {
            return cb(null, { status: false, code: 2001, error: 'link is required' });
        }

        // CHECK DUPLICATION
        const check = await pool.query(
            `SELECT social_media_id FROM cms_social_media_info
             WHERE UPPER(link) = UPPER($1)
               AND is_deleted = FALSE`,
            [link.trim()]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Cms Social Media Info already exists' });
        }

        const insert = await pool.query(
            `INSERT INTO cms_social_media_info
             ( link, icon, created_by,assigned_to)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [
                link.trim(),
                icon || null,
                created_by || null,
                created_by
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Social Media Info created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (create Cms Social Media Info):', err);
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
// LIST 
// --------------------------------------------------
responder.on('list-cmssocialmediainfo', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT 
        co.* FROM cms_social_media_info co
     WHERE co.is_deleted = FALSE
     ORDER BY co.created_at ASC`
        );


        return cb(null, {
            status: true,
            code: 1000, message: "Cms Social Media Info list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (list Cms Social Media Info):', err);
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
// GET LIST BY UUID
// --------------------------------------------------
responder.on('getById-cmssocialmediainfo', async (req, cb) => {
    try {
        const { social_media_uuid  } = req;

        const result = await pool.query(
            `SELECT * FROM cms_social_media_info
             WHERE social_media_uuid  = $1 AND is_deleted = FALSE`,
            [social_media_uuid ]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Social Media Info not found' });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        logger.error('Responder Error (get Cms Social Media Info):', err);
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
// UPDATE 
// --------------------------------------------------
responder.on('update-cmssocialmediainfo', async (req, cb) => {
    try {
        const {
            social_media_uuid ,
            link,
            icon,
            modified_by, is_active
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!social_media_uuid ) {
            return cb(null, { status: false, code: 2001, error: 'Cms Social Media Info UUID is required' });
        }

        if (!link || !link.trim()) {
            return cb(null, { status: false, code: 2001, error: 'Cms Social Media Info link is required' });
        }


        // -----------------------------
        // CHECK RECORD EXISTS
        // -----------------------------
        const exists = await pool.query(
            `SELECT social_media_id, icon FROM cms_social_media_info
             WHERE social_media_uuid  = $1 AND is_deleted = FALSE`,
            [social_media_uuid ]
        );

        if (exists.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Social Media Info not found' });
        }

        const existingImagePath = exists.rows[0].icon;

        // -----------------------------
        // DUPLICATE CHECK (EXCLUDE SELF)
        // -----------------------------
        const check = await pool.query(
            `SELECT social_media_uuid  FROM cms_social_media_info
             WHERE UPPER(link) = UPPER($1)
               AND is_deleted = FALSE
               AND social_media_uuid  != $2`,
            [link.trim(), social_media_uuid ]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Cms Social Media Info already exists' });
        }

        // -----------------------------
        // UPDATE
        // -----------------------------
        const update = await pool.query(
            `UPDATE cms_social_media_info
             SET link = $1,
                 icon = $2,
                 modified_by = $3,is_active=$4,
                 modified_at = NOW()
             WHERE social_media_uuid  = $5
             RETURNING *`,
            [
                link.trim(),
                icon || existingImagePath, 
                modified_by || null, is_active,
                social_media_uuid 
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Social Media Info updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (update Cms Social Media Info):', err);
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
// DELETE (SOFT DELETE)
// --------------------------------------------------
responder.on('delete-cmssocialmediainfo', async (req, cb) => {
    try {
        const social_media_uuid  = req.social_media_uuid ;
        const deleted_by = req.body.deleted_by;

        const check = await pool.query(
            `SELECT social_media_id FROM cms_social_media_info
             WHERE social_media_uuid  = $1 AND is_deleted = FALSE`,
            [social_media_uuid ]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Social Media Info not found' });
        }

        await pool.query(
            `UPDATE cms_social_media_info
             SET is_deleted = TRUE,
                 is_active = FALSE,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE social_media_uuid  = $2`,
            [deleted_by || null, social_media_uuid ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Social Media Info deleted successfully'
        });

    } catch (err) {
        logger.error('Responder Error (delete Cms Social Media Info):', err);
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
// STATUS CHANGE 
// --------------------------------------------------
responder.on('status-cmssocialmediainfo', async (req, cb) => {
    try {
        const social_media_uuid  = req.social_media_uuid ;
        const modified_by = req.body.modified_by;

        const check = await pool.query(
            `SELECT is_active FROM cms_social_media_info
             WHERE social_media_uuid  = $1 AND is_deleted = FALSE`,
            [social_media_uuid ]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Social Media Info not found' });
        }

        const newStatus = !check.rows[0].is_active;

        await pool.query(
            `UPDATE cms_social_media_info
             SET is_active = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE social_media_uuid  = $3`,
            [newStatus, modified_by || null, social_media_uuid ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Social Media Info status updated successfully'
        });

    } catch (err) {
        logger.error('Responder Error (status Cms Social Media Info):', err);
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
// ADVANCE FILTER 
// --------------------------------------------------
responder.on('advancefilter-cmssocialmediainfo', async (req, cb) => {
    try {

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table: 'cms_social_media_info',
            alias: 'C',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators ON C.created_by = creators.user_uuid
                LEFT JOIN users updaters ON C.modified_by = updaters.user_uuid
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'link',
                'is_active',
                'created_at',
                'modified_at',
                'createdByName',
                'updatedByName'
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
                C.is_deleted = FALSE
            `
        });

        return cb(null, {
            status: true,
            code: 1000,
            result
        });

    } catch (err) {
        logger.error('[advancefilter-Cms Social Media Info] error:', err);
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
//  LIST (SEARCH + PAGINATION)
// --------------------------------------------------
responder.on("cmssocialmediainfo-list", async (req, cb) => {
    try {
        const {
            search = "",
            page = 1,
            limit = 10
        } = req;

        const pageNo = parseInt(page, 10);
        const limitNo = parseInt(limit, 10);
        const offset = (pageNo - 1) * limitNo;

        let params = [];
        let whereSql = `WHERE is_deleted = FALSE`;
        let idx = 1;

        /* ---------------- SEARCH CONDITION ---------------- */
        if (search) {
            whereSql += ` AND LOWER(link) ILIKE LOWER($${idx})`;
            params.push(`%${search}%`);
            idx++;
        }

        /* ---------------- TOTAL COUNT ---------------- */
        const countResult = await pool.query(
            `SELECT COUNT(*) AS total
             FROM cms_social_media_info
             ${whereSql}`,
            params
        );

        const totalRecords = parseInt(countResult.rows[0].total, 10);

        /* ---------------- DATA QUERY ---------------- */
        params.push(limitNo, offset);

        const result = await pool.query(
            `SELECT *
             FROM cms_social_media_info
             ${whereSql}
             ORDER BY link ASC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            params
        );

        return cb(null, {
            status: true,
            code: 1000,
            data: {
                count: result.rowCount,
                total: totalRecords,
                page: pageNo,
                limit: limitNo,
                data: result.rows
            }
        });

    } catch (err) {
        logger.error("Responder Error (Cms Social Media Info-list):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});
