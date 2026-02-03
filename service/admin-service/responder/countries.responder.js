require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'countries responder',
    key: 'countries',
    redis: { host: redisHost, port: redisPort }
});

// --------------------------------------------------
// CREATE COUNTRY
// --------------------------------------------------
responder.on('create-country', async (req, cb) => {
    try {
        const {
            name,
            country_code,
            iso_code,
            currency_uuid,
            flag_icon_path,
            description,
            created_by, assigned_to, code
        } = req.body;

        if (!name || !name.trim()) {
            return cb(null, { status: false, code: 2001, error: 'Country name is required' });
        }

        if (!country_code || !country_code.trim()) {
            return cb(null, { status: false, code: 2001, error: 'Country code is required' });
        }
        if (!code || !code.trim()) {
            return cb(null, { status: false, code: 2001, error: 'Code is required' });
        }

        // Validate currency_uuid and fetch currency_id
        const countryResult = await pool.query(
            `SELECT currency_id 
             FROM currency
             WHERE currency_uuid = $1
               AND is_deleted = FALSE
               AND is_active = TRUE`,
            [currency_uuid]
        );

        if (countryResult.rowCount === 0) {
            return cb(null, {
                status: false,
                code: 2001,
                error: 'Invalid or inactive currency'
            });
        }

        const currency_id = countryResult.rows[0].currency_id;

        // CHECK DUPLICATE COUNTRY
        const check = await pool.query(
            `SELECT country_id FROM countries
             WHERE (UPPER(name) = UPPER($1)
                OR country_code = $2)
               AND is_deleted = FALSE`,
            [name.trim(), country_code.trim()]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Country already exists' });
        }

        const insert = await pool.query(
            `INSERT INTO countries
             ( name, country_code, iso_code, currency_id, flag_icon_path, description, created_by,assigned_to,code)
             VALUES ($1, $2, $3, $4, $5, $6, $7,$8,$9)
             RETURNING *`,
            [
                name.trim(),
                country_code.trim(),
                iso_code || null,
                currency_id || null,
                flag_icon_path || null,
                description || null,
                created_by || null,
                assigned_to, code
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Country created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (create country):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// LIST COUNTRIES
// --------------------------------------------------
responder.on('list-country', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT 
        co.*,
        cu.currency_uuid
     FROM countries co
     LEFT JOIN currency cu
            ON co.currency_id = cu.currency_id
     WHERE co.is_deleted = FALSE
     ORDER BY co.created_at DESC`
        );


        return cb(null, {
            status: true,
            code: 1000, 
            message: "Country list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (list country):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// GET COUNTRY BY UUID
// --------------------------------------------------
responder.on('getById-country', async (req, cb) => {
    try {
        const { country_uuid } = req;

        const result = await pool.query(
            `SELECT 
                co.*,
                cu.currency_uuid
             FROM countries co
             LEFT JOIN currency cu
               ON co.currency_id = cu.currency_id
             WHERE co.country_uuid = $1 
               AND co.is_deleted = FALSE`,
            [country_uuid]   // ✅ comma added here
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Country not found' });
        }

        return cb(null, { status: true, code: 1000, 
             message: "Country fetched successfully",data: result.rows[0] });

    } catch (err) {
        logger.error('Responder Error (get country):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// UPDATE COUNTRY
// --------------------------------------------------
responder.on('update-country', async (req, cb) => {
    try {
        const {
            country_uuid,
            name,
            country_code,
            iso_code,
            currency_uuid,
            flag_icon_path,
            description,
            modified_by, is_active
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!country_uuid) {
            return cb(null, { status: false, code: 2001, error: 'Country UUID is required' });
        }

        if (!name || !name.trim()) {
            return cb(null, { status: false, code: 2001, error: 'Country name is required' });
        }

        // Validate currency_uuid and fetch currency_id
        const countryResult = await pool.query(
            `SELECT currency_id 
             FROM currency
             WHERE currency_uuid = $1
               AND is_deleted = FALSE
               AND is_active = TRUE`,
            [currency_uuid]
        );

        if (countryResult.rowCount === 0) {
            return cb(null, {
                status: false,
                code: 2001,
                error: 'Invalid or inactive currency'
            });
        }

        const currency_id = countryResult.rows[0].currency_id;

        // -----------------------------
        // CHECK COUNTRY EXISTS
        // -----------------------------
        const exists = await pool.query(
            `SELECT country_id, flag_icon_path FROM countries
             WHERE country_uuid = $1 AND is_deleted = FALSE`,
            [country_uuid]
        );

        if (exists.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Country not found' });
        }

        const existingFlagPath = exists.rows[0].flag_icon_path;

        // -----------------------------
        // DUPLICATE CHECK (EXCLUDE SELF)
        // -----------------------------
        const check = await pool.query(
            `SELECT country_uuid FROM countries
             WHERE (UPPER(name) = UPPER($1)
                OR country_code = $2)
               AND is_deleted = FALSE
               AND country_uuid != $3`,
            [name.trim(), country_code, country_uuid]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Country already exists' });
        }

        // -----------------------------
        // UPDATE
        // -----------------------------
        const update = await pool.query(
            `UPDATE countries
             SET name = $1,
                 country_code = $2,
                 iso_code = $3,
                 currency_id = $4,
                 flag_icon_path = $5,
                 description = $6,
                 modified_by = $7,is_active=$8,
                 modified_at = NOW()
             WHERE country_uuid = $9
             RETURNING *`,
            [
                name.trim(),
                country_code,
                iso_code || null,
                currency_id || null,
                flag_icon_path || existingFlagPath, // 👈 keep old flag if not sent
                description || null,
                modified_by || null, is_active,
                country_uuid
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Country updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (update country):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// DELETE COUNTRY (SOFT DELETE)
// --------------------------------------------------
responder.on('delete-country', async (req, cb) => {
    try {
        const country_uuid = req.country_uuid;
        const deleted_by = req.body.deleted_by;

        const check = await pool.query(
            `SELECT country_id FROM countries
             WHERE country_uuid = $1 AND is_deleted = FALSE`,
            [country_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Country not found' });
        }

        await pool.query(
            `UPDATE countries
             SET is_deleted = TRUE,
                 is_active = FALSE,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE country_uuid = $2`,
            [deleted_by || null, country_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Country deleted successfully'
        });

    } catch (err) {
        logger.error('Responder Error (delete country):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// STATUS CHANGE COUNTRY
// --------------------------------------------------
responder.on('status-country', async (req, cb) => {
    try {
        const country_uuid = req.country_uuid;
        const modified_by = req.body.modified_by;

        const check = await pool.query(
            `SELECT is_active FROM countries
             WHERE country_uuid = $1 AND is_deleted = FALSE`,
            [country_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Country not found' });
        }

        const newStatus = !check.rows[0].is_active;

        await pool.query(
            `UPDATE countries
             SET is_active = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE country_uuid = $3`,
            [newStatus, modified_by || null, country_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Country status updated successfully'
        });

    } catch (err) {
        logger.error('Responder Error (status country):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// ADVANCE FILTER — COUNTRIES
// --------------------------------------------------
responder.on('advancefilter-country', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        let extraWhere = '';
        let extraParams = [];

        // If PRIVATE → only show own created data
        if (accessScope && accessScope.type === 'PRIVATE') {
            extraWhere = ' AND C.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table: 'countries',
            alias: 'C',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators ON C.created_by = creators.user_uuid
                LEFT JOIN users updaters ON C.modified_by = updaters.user_uuid
                LEFT JOIN currency CY ON C.currency_id = CY.currency_id
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'name',
                'country_code',
                'iso_code',
                'currency_id',
                'is_active',
                'created_at',
                'modified_at',
                'createdByName', 'code',
                'updatedByName', 'currency_name'
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
                },
                currency_name: {
                    select: 'CY.name',
                    search: 'CY.name',
                    sort: 'CY.name'
                }
            },

            /* ---------------- Base Where ---------------- */
            baseWhere: `
                C.is_deleted = FALSE ${extraWhere}
            `,
            baseParams: extraParams
        });

        return cb(null, {
            status: true,
            code: 1000,
            result
        });

    } catch (err) {
        logger.error('[advancefilter-country] error:', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// CLONE COUNTRY
// --------------------------------------------------
responder.on('clone-country', async (req, cb) => {
    try {
        const country_uuid = req.country_uuid;
        const { created_by } = req.body;

        const fetch = await pool.query(
            `SELECT name, country_code, iso_code, currency_id,
                    flag_icon_path, description, is_active
             FROM countries
             WHERE country_uuid = $1 AND is_deleted = FALSE`,
            [country_uuid]
        );

        if (!fetch.rowCount) {
            return cb(null, { status: false, code: 2003, error: 'Country not found' });
        }

        const c = fetch.rows[0];

        const insert = await pool.query(
            `INSERT INTO countries
             (country_uuid, name, country_code, iso_code, currency_id,
              flag_icon_path, description, is_active, created_by)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                c.name + ' (Copy)',
                c.country_code + '_COPY',
                c.iso_code,
                c.currency_id,
                c.flag_icon_path,
                c.description,
                c.is_active,
                created_by || null
            ]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Country cloned successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (clone country):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});



// --------------------------------------------------
// COUNTRY LIST (SEARCH + PAGINATION)
// --------------------------------------------------
responder.on("country-list", async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;

        const {
            search = "",
            page = 1,
            limit = 10
        } = req;

        const pageNo = parseInt(page, 10);
        const limitNo = parseInt(limit, 10);
        const offset = (pageNo - 1) * limitNo;

        let params = [];
        let idx = 1;

        /* ---------------- BASE WHERE ---------------- */
        let whereSql = `WHERE co.is_deleted = FALSE`;

        /* ---------------- PRIVATE ACCESS ---------------- */
        if (accessScope?.type === 'PRIVATE') {
            whereSql += ` AND co.created_by = $${idx}`;
            params.push(accessScope.user_id);
            idx++;
        }

        /* ---------------- SEARCH ---------------- */
        if (search) {
            whereSql += ` AND LOWER(co.name) ILIKE LOWER($${idx})`;
            params.push(`%${search}%`);
            idx++;
        }

        /* ---------------- TOTAL COUNT ---------------- */
        const countResult = await pool.query(
            `
            SELECT COUNT(*) AS total
            FROM countries co
            ${whereSql}
            `,
            params
        );

        const totalRecords = parseInt(countResult.rows[0].total, 10);

        /* ---------------- DATA QUERY ---------------- */
        params.push(limitNo, offset);

        const result = await pool.query(
            `
            SELECT 
                co.*,
                cu.currency_uuid
            FROM countries co
            LEFT JOIN currency cu
                ON co.currency_id = cu.currency_id
            ${whereSql}
            ORDER BY co.created_at DESC
            LIMIT $${idx} OFFSET $${idx + 1}
            `,
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
        logger.error("Responder Error (country-list):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});

