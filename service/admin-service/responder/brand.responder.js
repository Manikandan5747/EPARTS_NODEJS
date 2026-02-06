require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'brand responder',
    key: 'brand',
    redis: { host: redisHost, port: redisPort }
});

// --------------------------------------------------
// CREATE BRAND
// --------------------------------------------------
responder.on('create-brand', async (req, cb) => {
    try {
        const {
            name,
            code,
            description,
            erp_id,
            last_integrated_date,
            logo_path,
            created_by,
            assigned_to
        } = req.body;

        if (!name || !name.trim()) {
            return cb(null, { status: false, code: 2001, error: 'brand name is required' });
        }

        if (!code || !code.trim()) {
            return cb(null, { status: false, code: 2001, error: 'brand code is required' });
        }


        // CHECK DUPLICATE brand
        const check = await pool.query(
            `SELECT brand_id FROM brand
             WHERE (UPPER(name) = UPPER($1)
                OR code = $2)
               AND is_deleted = FALSE`,
            [name.trim(), code.trim()]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'brand already exists' });
        }

        const insert = await pool.query(
            `INSERT INTO brand
             ( name, code, description, erp_id, last_integrated_date, logo_path, created_by,assigned_to)
             VALUES ($1, $2, $3, $4, $5, $6, $7,$8)
             RETURNING *`,
            [
                name.trim(),
                code.trim(),
                description || null,
                erp_id || null,
                last_integrated_date || null,
                logo_path || null,
                created_by || null,
                created_by
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'brand created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (create brand):', err);
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
// LIST BRAND
// --------------------------------------------------
responder.on('list-brand', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT 
        co.* FROM brand co
     WHERE co.is_deleted = FALSE
     ORDER BY co.created_at ASC`
        );


        return cb(null, {
            status: true,
            code: 1000, message: "brand list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (list brand):', err);
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
// GET BRAND BY UUID
// --------------------------------------------------
responder.on('getById-brand', async (req, cb) => {
    try {
        const { brand_uuid } = req;

        const result = await pool.query(
            `SELECT * FROM brand
             WHERE brand_uuid = $1 AND is_deleted = FALSE`,
            [brand_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'brand not found' });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        logger.error('Responder Error (get brand):', err);
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
// UPDATE BRAND
// --------------------------------------------------
responder.on('update-brand', async (req, cb) => {
    try {
        const {
            brand_uuid,
            name,
            code,
            erp_id,
            last_integrated_date,
            logo_path,
            description,
            modified_by, is_active
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!brand_uuid) {
            return cb(null, { status: false, code: 2001, error: 'brand UUID is required' });
        }

        if (!name || !name.trim()) {
            return cb(null, { status: false, code: 2001, error: 'brand name is required' });
        }


        // -----------------------------
        // CHECK brand EXISTS
        // -----------------------------
        const exists = await pool.query(
            `SELECT brand_id, logo_path FROM brand
             WHERE brand_uuid = $1 AND is_deleted = FALSE`,
            [brand_uuid]
        );

        if (exists.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'brand not found' });
        }

        const existinglogoPath = exists.rows[0].logo_path;

        // -----------------------------
        // DUPLICATE CHECK (EXCLUDE SELF)
        // -----------------------------
        const check = await pool.query(
            `SELECT brand_uuid FROM brand
             WHERE (UPPER(name) = UPPER($1)
                OR code = $2)
               AND is_deleted = FALSE
               AND brand_uuid != $3`,
            [name.trim(), code, brand_uuid]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'brand already exists' });
        }

        // -----------------------------
        // UPDATE
        // -----------------------------
        const update = await pool.query(
            `UPDATE brand
             SET name = $1,
                 code = $2,
                 erp_id = $3,
                 last_integrated_date = $4,
                 logo_path = $5,
                 description = $6,
                 modified_by = $7,is_active=$8,
                 modified_at = NOW()
             WHERE brand_uuid = $9
             RETURNING *`,
            [
                name.trim(),
                code,
                erp_id || null,
                last_integrated_date || null,
                logo_path || existinglogoPath, //keep old flag if not sent
                description || null,
                modified_by || null, is_active,
                brand_uuid
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'brand updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (update brand):', err);
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
// DELETE BRAND (SOFT DELETE)
// --------------------------------------------------
responder.on('delete-brand', async (req, cb) => {
    try {
        const brand_uuid = req.brand_uuid;
        const deleted_by = req.body.deleted_by;

        const check = await pool.query(
            `SELECT brand_id FROM brand
             WHERE brand_uuid = $1 AND is_deleted = FALSE`,
            [brand_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'brand not found' });
        }

        await pool.query(
            `UPDATE brand
             SET is_deleted = TRUE,
                 is_active = FALSE,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE brand_uuid = $2`,
            [deleted_by || null, brand_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'brand deleted successfully'
        });

    } catch (err) {
        logger.error('Responder Error (delete brand):', err);
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
// STATUS CHANGE BRAND
// --------------------------------------------------
responder.on('status-brand', async (req, cb) => {
    try {
        const brand_uuid = req.brand_uuid;
        const modified_by = req.body.modified_by;

        const check = await pool.query(
            `SELECT is_active FROM brand
             WHERE brand_uuid = $1 AND is_deleted = FALSE`,
            [brand_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'brand not found' });
        }

        const newStatus = !check.rows[0].is_active;

        await pool.query(
            `UPDATE brand
             SET is_active = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE brand_uuid = $3`,
            [newStatus, modified_by || null, brand_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'brand status updated successfully'
        });

    } catch (err) {
        logger.error('Responder Error (status brand):', err);
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
// ADVANCE FILTER — BRAND
// --------------------------------------------------
responder.on('advancefilter-brand', async (req, cb) => {
    try {

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table: 'brand',
            alias: 'C',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators ON C.created_by = creators.user_uuid
                LEFT JOIN users updaters ON C.modified_by = updaters.user_uuid
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'name',
                'code',
                'erp_id',
                'last_integrated_date',
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
        logger.error('[advancefilter-brand] error:', err);
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
// BRAND LIST (SEARCH + PAGINATION)
// --------------------------------------------------
responder.on("brand-list", async (req, cb) => {
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
            whereSql += ` AND LOWER(name) ILIKE LOWER($${idx})`;
            params.push(`%${search}%`);
            idx++;
        }

        /* ---------------- TOTAL COUNT ---------------- */
        const countResult = await pool.query(
            `SELECT COUNT(*) AS total
             FROM brand
             ${whereSql}`,
            params
        );

        const totalRecords = parseInt(countResult.rows[0].total, 10);

        /* ---------------- DATA QUERY ---------------- */
        params.push(limitNo, offset);

        const result = await pool.query(
            `SELECT *
             FROM brand
             ${whereSql}
             ORDER BY name ASC
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
        logger.error("Responder Error (brand-list):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});
