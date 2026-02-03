require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'cms_homepage_buyerseller_section responder',
    key: 'cms_homepage_buyerseller_section',
    redis: { host: redisHost, port: redisPort }
});

// --------------------------------------------------
// CREATE 
// --------------------------------------------------
responder.on('create-cmshomepagebuyersellersection', async (req, cb) => {
    try {
        const {
            buyer_title,
            buyer_content,
            buyer_link,
            buyer_image,
            seller_title,
            seller_content,
            seller_link,
            seller_image,
            created_by, 
            assigned_to
        } = req.body;

        if (!buyer_title || !buyer_title.trim()) {
            return cb(null, { status: false, code: 2001, error: 'buyer title is required' });
        }
         if (!buyer_content || !buyer_content.trim()) {
            return cb(null, { status: false, code: 2001, error: 'buyer content is required' });
        }
         if (!seller_title || !seller_title.trim()) {
            return cb(null, { status: false, code: 2001, error: 'seller title is required' });
        }
         if (!seller_content || !seller_content.trim()) {
            return cb(null, { status: false, code: 2001, error: 'seller content is required' });
        }
        // CHECK DUPLICATION
        const check = await pool.query(
            `SELECT buyerseller_id FROM cms_homepage_buyerseller_section
             WHERE UPPER(buyer_title) = UPPER($1) OR UPPER(seller_title) = UPPER($2)
               AND is_deleted = FALSE`,
            [buyer_title.trim(),seller_title.trim()]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Cms Homepage Buyerseller Section already exists' });
        }

        const insert = await pool.query(
            `INSERT INTO cms_homepage_buyerseller_section
             (buyer_title, buyer_content, buyer_link, buyer_image, seller_title, seller_content, seller_link, seller_image, created_by,assigned_to)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                buyer_title.trim(),
                buyer_content.trim(),
                buyer_link.trim(),
                buyer_image || null,
                seller_title.trim(),
                seller_content.trim(),
                seller_link.trim(),
                seller_image || null,
                created_by || null,
                created_by
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Homepage Buyerseller Section created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (create Cms Homepage Buyerseller Section):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// LIST 
// --------------------------------------------------
responder.on('list-cmshomepagebuyersellersection', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT 
        co.* FROM cms_homepage_buyerseller_section co
     WHERE co.is_deleted = FALSE
     ORDER BY co.created_at ASC`
        );


        return cb(null, {
            status: true,
            code: 1000, message: "Cms Homepage Buyerseller Section list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (list Cms Homepage Buyerseller Section):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// GET LIST BY UUID
// --------------------------------------------------
responder.on('getById-cmshomepagebuyersellersection', async (req, cb) => {
    try {
        const { buyerseller_uuid  } = req;

        const result = await pool.query(
            `SELECT * FROM cms_homepage_buyerseller_section
             WHERE buyerseller_uuid  = $1 AND is_deleted = FALSE`,
            [buyerseller_uuid ]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Homepage Buyerseller Section not found' });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        logger.error('Responder Error (get Cms Homepage Buyerseller Section):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// UPDATE 
// --------------------------------------------------
responder.on('update-cmshomepagebuyersellersection', async (req, cb) => {
    try {
        const {
            buyerseller_uuid ,
            buyer_title,
            buyer_content,
            buyer_link,
            buyer_image,
            seller_title,
            seller_content,
            seller_link,
            seller_image,
            modified_by, 
            is_active
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!buyerseller_uuid ) {
            return cb(null, { status: false, code: 2001, error: 'Cms Homepage Buyerseller Section UUID is required' });
        }

              if (!buyer_title || !buyer_title.trim()) {
            return cb(null, { status: false, code: 2001, error: 'buyer title is required' });
        }
         if (!buyer_content || !buyer_content.trim()) {
            return cb(null, { status: false, code: 2001, error: 'buyer content is required' });
        }
         if (!seller_title || !seller_title.trim()) {
            return cb(null, { status: false, code: 2001, error: 'seller title is required' });
        }
         if (!seller_content || !seller_content.trim()) {
            return cb(null, { status: false, code: 2001, error: 'seller content is required' });
        }

        // -----------------------------
        // CHECK RECORD EXISTS
        // -----------------------------
        const exists = await pool.query(
            `SELECT buyerseller_id FROM cms_homepage_buyerseller_section
             WHERE buyerseller_uuid  = $1 AND is_deleted = FALSE`,
            [buyerseller_uuid ]
        );

        if (exists.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Homepage Buyerseller Section not found' });
        }

        const existingBuyerImagePath = exists.rows[0].buyer_image;
        const existingSellerImagePath = exists.rows[0].seller_image;

        // -----------------------------
        // DUPLICATE CHECK (EXCLUDE SELF)
        // -----------------------------
        const check = await pool.query(
            `SELECT buyerseller_uuid  FROM cms_homepage_buyerseller_section
             WHERE UPPER(buyer_title) = UPPER($1) OR UPPER(seller_title) = UPPER($2)
               AND is_deleted = FALSE
               AND buyerseller_uuid  != $3`,
            [buyer_title.trim(),seller_title.trim(), buyerseller_uuid ]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Cms Homepage Buyerseller Section already exists' });
        }

        // -----------------------------
        // UPDATE
        // -----------------------------
        const update = await pool.query(
            `UPDATE cms_homepage_buyerseller_section
             SET buyer_title   = $1,
                buyer_content = $2,
                buyer_link    = $3,
                buyer_image   = $4,
                seller_title  = $5,
                seller_content= $6,
                seller_link   = $7,
                seller_image  = $8,
                 modified_by = $9,
                 is_active=$10,
                 modified_at = NOW()
             WHERE buyerseller_uuid  = $11
             RETURNING *`,
            [
                buyer_title.trim(),
                buyer_content.trim(),
                buyer_link.trim(),
                buyer_image || existingBuyerImagePath, 
                seller_title.trim(),
                seller_content.trim(),
                seller_link.trim(),
                seller_image || existingSellerImagePath, 
                modified_by || null, 
                is_active,
                buyerseller_uuid 
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Homepage Buyerseller Section updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (update Cms Homepage Buyerseller Section):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// DELETE (SOFT DELETE)
// --------------------------------------------------
responder.on('delete-cmshomepagebuyersellersection', async (req, cb) => {
    try {
        const buyerseller_uuid  = req.buyerseller_uuid ;
        const deleted_by = req.body.deleted_by;

        const check = await pool.query(
            `SELECT buyerseller_id FROM cms_homepage_buyerseller_section
             WHERE buyerseller_uuid  = $1 AND is_deleted = FALSE`,
            [buyerseller_uuid ]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Homepage Buyerseller Section not found' });
        }

        await pool.query(
            `UPDATE cms_homepage_buyerseller_section
             SET is_deleted = TRUE,
                 is_active = FALSE,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE buyerseller_uuid  = $2`,
            [deleted_by || null, buyerseller_uuid ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Homepage Buyerseller Section deleted successfully'
        });

    } catch (err) {
        logger.error('Responder Error (delete Cms Homepage Buyerseller Section):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// STATUS CHANGE 
// --------------------------------------------------
responder.on('status-cmshomepagebuyersellersection', async (req, cb) => {
    try {
        const buyerseller_uuid  = req.buyerseller_uuid ;
        const modified_by = req.body.modified_by;

        const check = await pool.query(
            `SELECT is_active FROM cms_homepage_buyerseller_section
             WHERE buyerseller_uuid  = $1 AND is_deleted = FALSE`,
            [buyerseller_uuid ]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Homepage Buyerseller Section not found' });
        }

        const newStatus = !check.rows[0].is_active;

        await pool.query(
            `UPDATE cms_homepage_buyerseller_section
             SET is_active = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE buyerseller_uuid  = $3`,
            [newStatus, modified_by || null, buyerseller_uuid ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Homepage Buyerseller Section status updated successfully'
        });

    } catch (err) {
        logger.error('Responder Error (status Cms Homepage Buyerseller Section):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// ADVANCE FILTER 
// --------------------------------------------------
responder.on('advancefilter-cmshomepagebuyersellersection', async (req, cb) => {
    try {

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table: 'cms_homepage_buyerseller_section',
            alias: 'C',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators ON C.created_by = creators.user_uuid
                LEFT JOIN users updaters ON C.modified_by = updaters.user_uuid
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'buyer_title',
                'buyer_content',
                'buyer_link',
                'seller_title',
                'seller_content',
                'seller_link',
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
        logger.error('[advancefilter-Cms Homepage Buyerseller Section] error:', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});



// --------------------------------------------------
//  LIST (SEARCH + PAGINATION)
// --------------------------------------------------
responder.on("cmshomepagebuyersellersection-list", async (req, cb) => {
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
    whereSql += ` AND (
        LOWER(buyer_title) ILIKE LOWER($${idx})
        OR LOWER(seller_title) ILIKE LOWER($${idx})
    )`;
    params.push(`%${search}%`);
    idx++;
}


        /* ---------------- TOTAL COUNT ---------------- */
        const countResult = await pool.query(
            `SELECT COUNT(*) AS total
             FROM cms_homepage_buyerseller_section
             ${whereSql}`,
            params
        );

        const totalRecords = parseInt(countResult.rows[0].total, 10);

        /* ---------------- DATA QUERY ---------------- */
        params.push(limitNo, offset);

        const result = await pool.query(
            `SELECT *
             FROM cms_homepage_buyerseller_section
             ${whereSql}
             ORDER BY created_at ASC
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
        logger.error("Responder Error (Cms Homepage Buyerseller Section-list):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});
