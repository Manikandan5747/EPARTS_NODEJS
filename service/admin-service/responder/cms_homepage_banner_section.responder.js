require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'cms_homepage_banner_section responder',
    key: 'cms_homepage_banner_section',
    redis: { host: redisHost, port: redisPort }
});

// --------------------------------------------------
// CREATE 
// --------------------------------------------------
responder.on('create-cmshomepagebannersection', async (req, cb) => {
    try {
        const {
            title,
            content,
            landscapeurl,
            portraiturl,
            filetype,
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

        // -----------------------------
        // GIF VALIDATION 
        // -----------------------------
        if (filetype && !filetype.toLowerCase().endsWith('.gif')) {
            return cb(null, {
                status: false,
                code: 2003,
                error: 'Only GIF files are allowed'
            });
        }

        // CHECK DUPLICATION
        const check = await pool.query(
            `SELECT banner_id FROM cms_homepage_banner_section
             WHERE (UPPER(title) = UPPER($1)
                OR content = $2)
               AND is_deleted = FALSE`,
            [title.trim(), content.trim()]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Cms Homepage Banner Section already exists' });
        }

        const insert = await pool.query(
            `INSERT INTO cms_homepage_banner_section
             ( title, content,landscapeurl,portraiturl,filetype,image,created_by,assigned_to)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                title.trim(),
                content.trim(),
                landscapeurl.trim(),
                portraiturl.trim(),
                filetype || null,
                image || null,
                created_by || null,
                created_by
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Homepage Banner Section created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (create Cms Homepage Banner Section):', err);
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
responder.on('list-cmshomepagebannersection', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT 
        co.* FROM cms_homepage_banner_section co
     WHERE co.is_deleted = FALSE
     ORDER BY co.created_at ASC`
        );


        return cb(null, {
            status: true,
            code: 1000, message: "Cms Homepage Banner Section list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (list Cms Homepage Banner Section):', err);
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
responder.on('getById-cmshomepagebannersection', async (req, cb) => {
    try {
        const { banner_uuid } = req;

        const result = await pool.query(
            `SELECT * FROM cms_homepage_banner_section
             WHERE banner_uuid = $1 AND is_deleted = FALSE`,
            [banner_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Homepage Banner Section not found' });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        logger.error('Responder Error (get Cms Homepage Banner Section):', err);
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
responder.on('update-cmshomepagebannersection', async (req, cb) => {
    try {
        const {
            banner_uuid,
            title,
            content,
            landscapeurl,
            portraiturl,
            filetype,
            image,
            modified_by, is_active
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!banner_uuid) {
            return cb(null, { status: false, code: 2001, error: 'Cms Homepage Banner Section UUID is required' });
        }

        if (!title || !title.trim()) {
            return cb(null, { status: false, code: 2001, error: 'Cms Homepage Banner Section title is required' });
        }


        // -----------------------------
        // CHECK RECORD EXISTS
        // -----------------------------
        const exists = await pool.query(
            `SELECT banner_id FROM cms_homepage_banner_section
             WHERE banner_uuid = $1 AND is_deleted = FALSE`,
            [banner_uuid]
        );

        if (exists.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Homepage Banner Section not found' });
        }

        const existingImagePath = exists.rows[0].image;
        const existingVideoPath = exists.rows[0].filetype;

           // -----------------------------
        // GIF VALIDATION
        // -----------------------------
        if (filetype && !filetype.toLowerCase().endsWith('.gif')) {
            return cb(null, {
                status: false,
                code: 2003,
                error: 'Only GIF files are allowed'
            });
        }

        // -----------------------------
        // DUPLICATE CHECK (EXCLUDE SELF)
        // -----------------------------
        const check = await pool.query(
            `SELECT banner_uuid FROM cms_homepage_banner_section
             WHERE (UPPER(title) = UPPER($1)
                OR content = $2)
               AND is_deleted = FALSE
               AND banner_uuid != $3`,
            [title.trim(), content, banner_uuid]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Cms Homepage Banner Section already exists' });
        }

        // -----------------------------
        // UPDATE
        // -----------------------------
        const update = await pool.query(
            `UPDATE cms_homepage_banner_section
             SET title = $1,
                 content = $2,
                 landscapeurl = $3,
            portraiturl = $4,
            filetype = $5,
                 image = $6,
                 modified_by = $7,is_active=$8,
                 modified_at = NOW()
             WHERE banner_uuid = $9
             RETURNING *`,
            [
                title.trim(),
                content.trim(),
                landscapeurl.trim(),
                portraiturl.trim(),
                filetype || existingVideoPath,
                image || existingImagePath, 
                modified_by || null, 
                is_active,
                banner_uuid
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Homepage Banner Section updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (update Cms Homepage Banner Section):', err);
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
responder.on('delete-cmshomepagebannersection', async (req, cb) => {
    try {
        const banner_uuid = req.banner_uuid;
        const deleted_by = req.body.deleted_by;

        const check = await pool.query(
            `SELECT banner_id FROM cms_homepage_banner_section
             WHERE banner_uuid = $1 AND is_deleted = FALSE`,
            [banner_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Homepage Banner Section not found' });
        }

        await pool.query(
            `UPDATE cms_homepage_banner_section
             SET is_deleted = TRUE,
                 is_active = FALSE,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE banner_uuid = $2`,
            [deleted_by || null, banner_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Homepage Banner Section deleted successfully'
        });

    } catch (err) {
        logger.error('Responder Error (delete Cms Homepage Banner Section):', err);
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
responder.on('status-cmshomepagebannersection', async (req, cb) => {
    try {
        const banner_uuid = req.banner_uuid;
        const modified_by = req.body.modified_by;

        const check = await pool.query(
            `SELECT is_active FROM cms_homepage_banner_section
             WHERE banner_uuid = $1 AND is_deleted = FALSE`,
            [banner_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Homepage Banner Section not found' });
        }

        const newStatus = !check.rows[0].is_active;

        await pool.query(
            `UPDATE cms_homepage_banner_section
             SET is_active = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE banner_uuid = $3`,
            [newStatus, modified_by || null, banner_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Homepage Banner Section status updated successfully'
        });

    } catch (err) {
        logger.error('Responder Error (status Cms Homepage Banner Section):', err);
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
responder.on('advancefilter-cmshomepagebannersection', async (req, cb) => {
    try {

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table: 'cms_homepage_banner_section',
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
                'landscapeurl',
                'portraiturl',
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
        logger.error('[advancefilter-Cms Homepage Banner Section] error:', err);
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
responder.on("cmshomepagebannersection-list", async (req, cb) => {
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
             FROM cms_homepage_banner_section
             ${whereSql}`,
            params
        );

        const totalRecords = parseInt(countResult.rows[0].total, 10);

        /* ---------------- DATA QUERY ---------------- */
        params.push(limitNo, offset);

        const result = await pool.query(
            `SELECT *
             FROM cms_homepage_banner_section
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
        logger.error("Responder Error (Cms Homepage Banner Section-list):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});
