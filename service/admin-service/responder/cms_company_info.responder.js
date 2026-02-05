require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'cms_company_info responder',
    key: 'cms_company_info',
    redis: { host: redisHost, port: redisPort }
});

// --------------------------------------------------
// CREATE 
// --------------------------------------------------
responder.on('create-cmscompanyinfo', async (req, cb) => {
    try {
        const {
         company_name,
        email,
        contact,
        description,
        logo,
        playstore_link,
        applestore_link,
        footer_image1,
        footer_image2,
        footer_image3,
        dynamics_image,
        copyrights,
            created_by, 
            assigned_to
        } = req.body;

        if (!company_name || !company_name.trim()) {
            return cb(null, { status: false, code: 2001, error: 'company name is required' });
        }
      
        // CHECK DUPLICATION
        const check = await pool.query(
            `SELECT cms_company_id FROM cms_company_info
             WHERE UPPER(company_name) = UPPER($1) 
               AND is_deleted = FALSE`,
            [company_name.trim()]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'cms_company_info already exists' });
        }

        const insert = await pool.query(
            `INSERT INTO cms_company_info
             (company_name, email, contact, description, logo, playstore_link, applestore_link, footer_image1, footer_image2, footer_image3, dynamics_image, copyrights,created_by,assigned_to)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING *`,
            [
               company_name.trim(),
                email.trim(),
                contact.trim(),
                description.trim(),
                logo || null,
                playstore_link.trim(),
                applestore_link.trim(),
                footer_image1 || null,
                footer_image2 || null,
                footer_image3 || null,
                dynamics_image || null,
                copyrights.trim(),
                created_by || null,
                created_by
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Company Info created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (create Cms Company Info):', err);
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
responder.on('list-cmscompanyinfo', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT 
        co.* FROM cms_company_info co
     WHERE co.is_deleted = FALSE
     ORDER BY co.created_at ASC`
        );


        return cb(null, {
            status: true,
            code: 1000, message: "Cms Company Info list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (list Cms Company Info):', err);
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
responder.on('getById-cmscompanyinfo', async (req, cb) => {
    try {
        const { cms_company_uuid  } = req;

        const result = await pool.query(
            `SELECT * FROM cms_company_info
             WHERE cms_company_uuid  = $1 AND is_deleted = FALSE`,
            [cms_company_uuid ]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Company Info not found' });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        logger.error('Responder Error (get Cms Company Info):', err);
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
responder.on('update-cmscompanyinfo', async (req, cb) => {
    try {
        const {
            cms_company_uuid ,
            company_name,
            email,
            contact,
            description,
            logo,
            playstore_link,
            applestore_link,
            footer_image1,
            footer_image2,
            footer_image3,
            dynamics_image,
            copyrights,
            modified_by, is_active
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!cms_company_uuid ) {
            return cb(null, { status: false, code: 2001, error: 'Cms Company Info UUID is required' });
        }

              if (!company_name || !company_name.trim()) {
            return cb(null, { status: false, code: 2001, error: 'company name is required' });
        }
     

        // -----------------------------
        // CHECK RECORD EXISTS
        // -----------------------------
        const exists = await pool.query(
            `SELECT cms_company_id FROM cms_company_info
             WHERE cms_company_uuid  = $1 AND is_deleted = FALSE`,
            [cms_company_uuid ]
        );

        if (exists.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Company Info not found' });
        }


        const existingLogoPath = exists.rows[0].logo;
        const existingFooterImage1Path = exists.rows[0].footer_image1;
        const existingFooterImage2Path = exists.rows[0].footer_image2;
        const existingFooterImage3Path = exists.rows[0].footer_image3;
        const existingDynamicsImagePath = exists.rows[0].dynamics_image;

        // -----------------------------
        // DUPLICATE CHECK (EXCLUDE SELF)
        // -----------------------------
        const check = await pool.query(
            `SELECT cms_company_uuid  FROM cms_company_info
             WHERE UPPER(company_name) = UPPER($1)
               AND is_deleted = FALSE
               AND cms_company_uuid  != $2`,
            [company_name.trim(),cms_company_uuid ]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Cms Company Info already exists' });
        }

        // -----------------------------
        // UPDATE
        // -----------------------------
        const update = await pool.query(
            `UPDATE cms_company_info
             SET company_name   = $1,
                email          = $2,
                contact        = $3,
                description    = $4,
                logo           = $5,
                playstore_link = $6,
                applestore_link= $7,
                footer_image1  = $8,
                footer_image2  = $9,
                footer_image3  = $10,
                dynamics_image = $11,
                copyrights     = $12,
                 modified_by = $13,is_active=$14,
                 modified_at = NOW()
             WHERE cms_company_uuid  = $15
             RETURNING *`,
            [
              company_name.trim(),
                email.trim(),
                contact.trim(),
                description.trim(),
                logo || existingLogoPath,
                playstore_link.trim(),
                applestore_link.trim(),
                footer_image1 || existingFooterImage1Path,
                footer_image2 || existingFooterImage2Path,
                footer_image3 || existingFooterImage3Path,
                dynamics_image || existingDynamicsImagePath,
                copyrights.trim(),
                modified_by || null, is_active,
                cms_company_uuid 
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Company Info updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (update Cms Company Info):', err);
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
responder.on('delete-cmscompanyinfo', async (req, cb) => {
    try {
        const cms_company_uuid  = req.cms_company_uuid ;
        const deleted_by = req.body.deleted_by;

        const check = await pool.query(
            `SELECT cms_company_id FROM cms_company_info
             WHERE cms_company_uuid  = $1 AND is_deleted = FALSE`,
            [cms_company_uuid ]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Company Info not found' });
        }

        await pool.query(
            `UPDATE cms_company_info
             SET is_deleted = TRUE,
                 is_active = FALSE,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE cms_company_uuid  = $2`,
            [deleted_by || null, cms_company_uuid ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Company Info deleted successfully'
        });

    } catch (err) {
        logger.error('Responder Error (delete Cms Company Info):', err);
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
responder.on('status-cmscompanyinfo', async (req, cb) => {
    try {
        const cms_company_uuid  = req.cms_company_uuid ;
        const modified_by = req.body.modified_by;

        const check = await pool.query(
            `SELECT is_active FROM cms_company_info
             WHERE cms_company_uuid  = $1 AND is_deleted = FALSE`,
            [cms_company_uuid ]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Cms Company Info not found' });
        }

        const newStatus = !check.rows[0].is_active;

        await pool.query(
            `UPDATE cms_company_info
             SET is_active = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE cms_company_uuid  = $3`,
            [newStatus, modified_by || null, cms_company_uuid ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Cms Company Info status updated successfully'
        });

    } catch (err) {
        logger.error('Responder Error (status Cms Company Info):', err);
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
responder.on('advancefilter-cmscompanyinfo', async (req, cb) => {
    try {

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table: 'cms_company_info',
            alias: 'C',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators ON C.created_by = creators.user_uuid
                LEFT JOIN users updaters ON C.modified_by = updaters.user_uuid
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
               'company_name',
                'email',
                'contact',
                'description',
                'playstore_link',
                'applestore_link',
                'copyrights',
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
        logger.error('[advancefilter-Cms Company Info] error:', err);
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
responder.on("cmscompanyinfo-list", async (req, cb) => {
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
        LOWER(company_name) ILIKE LOWER($${idx})
        
    )`;
    params.push(`%${search}%`);
    idx++;
}


        /* ---------------- TOTAL COUNT ---------------- */
        const countResult = await pool.query(
            `SELECT COUNT(*) AS total
             FROM cms_company_info
             ${whereSql}`,
            params
        );

        const totalRecords = parseInt(countResult.rows[0].total, 10);

        /* ---------------- DATA QUERY ---------------- */
        params.push(limitNo, offset);

        const result = await pool.query(
            `SELECT *
             FROM cms_company_info
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
        logger.error("Responder Error (Cms Company Info-list):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});
