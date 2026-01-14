require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'states responder',
    key: 'states',
    redis: { host: redisHost, port: redisPort }
});



// --------------------------------------------------
// CREATE STATE
// --------------------------------------------------
responder.on('create-state', async (req, cb) => {
    try {
        const { country_id, name, created_by, assigned_to } = req.body;

        if (!name || !name.trim()) {
            return cb(null, { status: false, code: 2001, error: 'State name is required' });
        }

        const stateName = name.trim();

        const duplicate = await pool.query(
            `SELECT state_id FROM states
             WHERE UPPER(name) = UPPER($1)
             AND country_id = $2
             AND is_deleted = FALSE`,
            [stateName, country_id]
        );

        if (duplicate.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'State already exists' });
        }

        const insert = await pool.query(
            `INSERT INTO states (state_uuid, country_id, name, created_by, assigned_to)
             VALUES (gen_random_uuid(), $1, $2, $3, $4)
             RETURNING *`,
            [country_id, stateName, created_by, assigned_to]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'State created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (create state):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// LIST STATES
// --------------------------------------------------
responder.on('list-state', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT * FROM states
             WHERE is_deleted = FALSE
             ORDER BY created_at ASC`
        );

        return cb(null, {
            status: true,
            code: 1000,
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (list state):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// GET STATE BY UUID
// --------------------------------------------------
responder.on('getById-state', async (req, cb) => {
    try {
        const { state_uuid } = req;

        const result = await pool.query(
            `SELECT 
        s.*,
        c.country_uuid
     FROM states s
     LEFT JOIN countries c 
            ON s.country_id = c.country_id
     WHERE s.state_uuid = $1
       AND s.is_deleted = FALSE`,
            [state_uuid]
        );


        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'State not found' });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        logger.error('Responder Error (getById state):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// UPDATE STATE
// --------------------------------------------------
responder.on('update-state', async (req, cb) => {
    try {
        const { state_uuid, body } = req;
        const { name, country_id, modified_by, is_active } = body;

        const result = await pool.query(`SELECT * FROM states WHERE state_uuid = $1 AND is_deleted = FALSE`, [state_uuid]);
        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'State not found' });
        }
        if (!name || !name.trim()) {
            return cb(null, { status: false, code: 2001, error: 'State name is required' });
        }

        const duplicate = await pool.query(
            `SELECT state_uuid FROM states
             WHERE UPPER(name) = UPPER($1)
             AND country_id = $2
             AND is_deleted = FALSE
             AND state_uuid != $3`,
            [name.trim(), country_id, state_uuid]
        );

        if (duplicate.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'State already exists' });
        }

        const update = await pool.query(
            `UPDATE states SET
                name = $1,
                country_id = $2,
                modified_by = $3,is_active=$4,
                modified_at = NOW()
             WHERE state_uuid = $5
             RETURNING *`,
            [name.trim(), country_id, modified_by, is_active, state_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'State updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (update state):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// DELETE STATE (SOFT DELETE)
// --------------------------------------------------
responder.on('delete-state', async (req, cb) => {
    try {
        const { state_uuid } = req;
        const { deleted_by } = req.body;

          const result = await pool.query(`SELECT * FROM states WHERE state_uuid = $1 AND is_deleted = FALSE`, [state_uuid]);
        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'State not found' });
        }

        await pool.query(
            `UPDATE states SET
                is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
             WHERE state_uuid = $2`,
            [deleted_by, state_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'State deleted successfully'
        });

    } catch (err) {
        logger.error('Responder Error (delete state):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// STATE STATUS CHANGE
// --------------------------------------------------
responder.on('status-state', async (req, cb) => {
    try {
        const { state_uuid } = req;
        const { modified_by, is_active } = req.body;

          const result = await pool.query(`SELECT * FROM states WHERE state_uuid = $1 AND is_deleted = FALSE`, [state_uuid]);
        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'State not found' });
        }
        
        await pool.query(
            `UPDATE states SET
                is_active = $1,
                modified_by = $2,
                modified_at = NOW()
             WHERE state_uuid = $3`,
            [is_active, modified_by, state_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'State status updated successfully'
        });

    } catch (err) {
        logger.error('Responder Error (status state):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// ADVANCE FILTER — STATES
// --------------------------------------------------
responder.on('advancefilter-state', async (req, cb) => {
    try {

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table: 'states',
            alias: 'ST',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN countries C ON ST.country_id = C.country_id
                LEFT JOIN users creators ON ST.created_by = creators.user_uuid
                LEFT JOIN users updaters ON ST.modified_by = updaters.user_uuid
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'name',
                'country_id',
                'country_name',
                'is_active',
                'created_at',
                'modified_at',
                'createdByName',
                'updatedByName'
            ],

            /* ---------------- Custom Joined Fields ---------------- */
            customFields: {
                country_name: {
                    select: 'C.name',
                    search: 'C.name',
                    sort: 'C.name'
                },
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
                ST.is_deleted = FALSE
            `
        });

        return cb(null, {
            status: true,
            code: 1000,
            result
        });

    } catch (err) {
        console.error('[advancefilter-state] error:', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// CLONE STATE
// --------------------------------------------------
responder.on('clone-state', async (req, cb) => {
    try {
        const { state_uuid } = req;
        const { created_by } = req.body;

        const { rows } = await pool.query(
            `SELECT country_id, name, is_active FROM states
             WHERE state_uuid = $1 AND is_deleted = FALSE`,
            [state_uuid]
        );

        if (!rows.length) {
            return cb(null, { status: false, code: 2003, error: 'Original state not found' });
        }

        const state = rows[0];

        const clone = await pool.query(
            `INSERT INTO states (state_uuid, country_id, name, is_active, created_by)
             VALUES (gen_random_uuid(), $1, $2, $3, $4)
             RETURNING *`,
            [state.country_id, state.name + ' (Copy)', state.is_active, created_by]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'State cloned successfully',
            data: clone.rows[0]
        });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});



// --------------------------------------------------
//  FIND STATES BY COUNTRY UUID
// --------------------------------------------------
responder.on('getById-countryid', async (req, cb) => {
    try {
        const { country_uuid } = req;

        if (!country_uuid) {
            return cb(null, { status: false, code: 2001, error: 'Country UUID is required' });
        }

        // 🔹 Get country_id from countries table
        const countryResult = await pool.query(
            `SELECT country_id FROM countries
             WHERE country_uuid = $1 AND is_deleted = FALSE`,
            [country_uuid]
        );

        if (countryResult.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Country not found' });
        }

        const country_id = countryResult.rows[0].country_id;

        // 🔹 Get states by country_id
        const result = await pool.query(
            `SELECT s.*, c.country_uuid  FROM states s
            LEFT JOIN countries c ON s.country_id = c.country_id
             WHERE country_id = $1 AND is_deleted = FALSE`,
            [country_id]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'State not found' });
        }

        return cb(null, {
            status: true,
            code: 1000,
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (getById countryid):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
//  STATE LIST BY COUNTRY UUID (SEARCH + PAGINATION)
// --------------------------------------------------
responder.on("state-list", async (req, cb) => {
    try {
        const {
            country_uuid,
            search = "",
            page = 1,
            limit = 10
        } = req;

        if (!country_uuid) {
            return cb(null, {
                status: false,
                code: 2001,
                error: "Country UUID is required"
            });
        }

        const pageNo = parseInt(page, 10);
        const limitNo = parseInt(limit, 10);
        const offset = (pageNo - 1) * limitNo;

        /* ----------------------------------
           1️⃣ GET COUNTRY ID
        ---------------------------------- */
        const countryResult = await pool.query(
            `SELECT country_id
             FROM countries
             WHERE country_uuid = $1
               AND is_deleted = FALSE`,
            [country_uuid]
        );

        if (countryResult.rowCount === 0) {
            return cb(null, {
                status: false,
                code: 2003,
                error: "Country not found"
            });
        }

        const country_id = countryResult.rows[0].country_id;

        /* ----------------------------------
           2️⃣ SEARCH CONDITION
        ---------------------------------- */
        let searchSql = "";
        let params = [country_id];
        let idx = 2;

        if (search) {
            searchSql = ` AND LOWER(s.name) LIKE LOWER($${idx}) `;
            params.push(`%${search}%`);
            idx++;
        }

        /* ----------------------------------
           3️⃣ TOTAL COUNT
        ---------------------------------- */
        const countQuery = await pool.query(
            `SELECT COUNT(*) AS total
             FROM states s
             WHERE s.country_id = $1
               AND s.is_deleted = FALSE
             ${searchSql}`,
            params
        );

        const totalRecords = parseInt(countQuery.rows[0].total, 10);

        /* ----------------------------------
           4️⃣ FETCH STATES WITH PAGINATION + JOIN
        ---------------------------------- */
        params.push(limitNo, offset);

        const result = await pool.query(
            `SELECT s.*, c.country_uuid, c.name AS country_name
             FROM states s
             LEFT JOIN countries c 
                    ON s.country_id = c.country_id
             WHERE s.country_id = $1
               AND s.is_deleted = FALSE
             ${searchSql}
             ORDER BY s.name ASC
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
        logger.error("Responder Error (state-list):", err);
        return cb(null, {
            status: false,
            code: 2004,
            error: err.message
        });
    }
});



