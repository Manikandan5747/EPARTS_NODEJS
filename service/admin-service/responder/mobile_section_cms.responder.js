require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'mobile_section_cms responder',
    key: 'mobile_section_cms',
    redis: { host: redisHost, port: redisPort }
});

// --------------------------------------------------
// CREATE MOBILE SECTION CMS
// --------------------------------------------------
responder.on('create-mobilesectioncms', async (req, cb) => {
    try {
        const {
            title,
            content,
            image,
            created_by, 
            assigned_to
        } = req.body;

        if (!title || !title.trim()) {
            return cb(null, { status: false, code: 2001, error: 'title is required' });
        }

        if (!content || !content.trim()) {
            return cb(null, { status: false, code: 2001, error: 'content is required' });
        }


        // CHECK DUPLICATION
        const check = await pool.query(
            `SELECT mobile_section_cms_id FROM mobile_section_cms
             WHERE (UPPER(title) = UPPER($1)
                OR content = $2)
               AND is_deleted = FALSE`,
            [title.trim(), content.trim()]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Mobile Section Cms already exists' });
        }

        const insert = await pool.query(
            `INSERT INTO mobile_section_cms
             ( title, content, image, created_by,assigned_to)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                title.trim(),
                content.trim(),
                image || null,
                created_by || null,
                created_by
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Mobile Section Cms created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (create Mobile Section Cms):', err);
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
// LIST MOBILE SECTION CMS
// --------------------------------------------------
responder.on('list-mobilesectioncms', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT 
        co.* FROM mobile_section_cms co
     WHERE co.is_deleted = FALSE
     ORDER BY co.created_at ASC`
        );


        return cb(null, {
            status: true,
            code: 1000, message: "Mobile Section Cms list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (list Mobile Section Cms):', err);
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
// GET MOBILE SECTION CMS BY UUID
// --------------------------------------------------
responder.on('getById-mobilesectioncms', async (req, cb) => {
    try {
        const { mobile_section_cms_uuid } = req;

        const result = await pool.query(
            `SELECT * FROM mobile_section_cms
             WHERE mobile_section_cms_uuid = $1 AND is_deleted = FALSE`,
            [mobile_section_cms_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Mobile Section Cms not found' });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        logger.error('Responder Error (get Mobile Section Cms):', err);
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
// UPDATE MOBILE SECTION CMS
// --------------------------------------------------
responder.on('update-mobilesectioncms', async (req, cb) => {
    try {
        const {
            mobile_section_cms_uuid,
            title,
            content,
            image,
            modified_by, is_active
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!mobile_section_cms_uuid) {
            return cb(null, { status: false, code: 2001, error: 'Mobile Section Cms UUID is required' });
        }

        if (!title || !title.trim()) {
            return cb(null, { status: false, code: 2001, error: 'Mobile Section Cms title is required' });
        }


        // -----------------------------
        // CHECK RECORD EXISTS
        // -----------------------------
        const exists = await pool.query(
            `SELECT mobile_section_cms_id, image FROM mobile_section_cms
             WHERE mobile_section_cms_uuid = $1 AND is_deleted = FALSE`,
            [mobile_section_cms_uuid]
        );

        if (exists.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Mobile Section Cms not found' });
        }

        const existingImagePath = exists.rows[0].image;

        // -----------------------------
        // DUPLICATE CHECK (EXCLUDE SELF)
        // -----------------------------
        const check = await pool.query(
            `SELECT mobile_section_cms_uuid FROM mobile_section_cms
             WHERE (UPPER(title) = UPPER($1)
                OR content = $2)
               AND is_deleted = FALSE
               AND mobile_section_cms_uuid != $3`,
            [title.trim(), content, mobile_section_cms_uuid]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Mobile Section Cms already exists' });
        }

        // -----------------------------
        // UPDATE
        // -----------------------------
        const update = await pool.query(
            `UPDATE mobile_section_cms
             SET title = $1,
                 content = $2,
                 image = $3,
                 modified_by = $4,is_active=$5,
                 modified_at = NOW()
             WHERE mobile_section_cms_uuid = $6
             RETURNING *`,
            [
                title.trim(),
                content,
                image || existingImagePath, 
                modified_by || null, is_active,
                mobile_section_cms_uuid
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Mobile Section Cms updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (update Mobile Section Cms):', err);
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
responder.on('delete-mobilesectioncms', async (req, cb) => {
    try {
        const mobile_section_cms_uuid = req.mobile_section_cms_uuid;
        const deleted_by = req.body.deleted_by;

        const check = await pool.query(
            `SELECT mobile_section_cms_id FROM mobile_section_cms
             WHERE mobile_section_cms_uuid = $1 AND is_deleted = FALSE`,
            [mobile_section_cms_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Mobile Section Cms not found' });
        }

        await pool.query(
            `UPDATE mobile_section_cms
             SET is_deleted = TRUE,
                 is_active = FALSE,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE mobile_section_cms_uuid = $2`,
            [deleted_by || null, mobile_section_cms_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Mobile Section Cms deleted successfully'
        });

    } catch (err) {
        logger.error('Responder Error (delete Mobile Section Cms):', err);
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
responder.on('status-mobilesectioncms', async (req, cb) => {
    try {
        const mobile_section_cms_uuid = req.mobile_section_cms_uuid;
        const modified_by = req.body.modified_by;

        const check = await pool.query(
            `SELECT is_active FROM mobile_section_cms
             WHERE mobile_section_cms_uuid = $1 AND is_deleted = FALSE`,
            [mobile_section_cms_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Mobile Section Cms not found' });
        }

        const newStatus = !check.rows[0].is_active;

        await pool.query(
            `UPDATE mobile_section_cms
             SET is_active = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE mobile_section_cms_uuid = $3`,
            [newStatus, modified_by || null, mobile_section_cms_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Mobile Section Cms status updated successfully'
        });

    } catch (err) {
        logger.error('Responder Error (status Mobile Section Cms):', err);
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
responder.on('advancefilter-mobilesectioncms', async (req, cb) => {
    try {

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table: 'mobile_section_cms',
            alias: 'C',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators ON C.created_by = creators.user_uuid
                LEFT JOIN users updaters ON C.modified_by = updaters.user_uuid
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'title',
                'content',
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
        logger.error('[advancefilter-Mobile Section Cms] error:', err);
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
responder.on("mobilesectioncms-list", async (req, cb) => {
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
            whereSql += ` AND LOWER(title) ILIKE LOWER($${idx})`;
            params.push(`%${search}%`);
            idx++;
        }

        /* ---------------- TOTAL COUNT ---------------- */
        const countResult = await pool.query(
            `SELECT COUNT(*) AS total
             FROM mobile_section_cms
             ${whereSql}`,
            params
        );

        const totalRecords = parseInt(countResult.rows[0].total, 10);

        /* ---------------- DATA QUERY ---------------- */
        params.push(limitNo, offset);

        const result = await pool.query(
            `SELECT *
             FROM mobile_section_cms
             ${whereSql}
             ORDER BY title ASC
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
        logger.error("Responder Error (Mobile Section Cms-list):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});
