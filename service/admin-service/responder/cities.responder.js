require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'cities responder',
    key: 'cities',
    redis: { host: redisHost, port: redisPort }
});

// --------------------------------------------------
// CREATE CITY
// --------------------------------------------------
responder.on('create-city', async (req, cb) => {
    try {
        const { country_id, state_id, name, created_by } = req.body;

        if (!name || !name.trim()) {
            return cb(null, { status: false, code: 2001, error: 'City name is required' });
        }

        if (!country_id || !state_id) {
            return cb(null, { status: false, code: 2001, error: 'Country ID and State ID are required' });
        }

        const cityName = name.trim();

        // Duplicate check (same city in same state & country)
        const duplicate = await pool.query(
            `SELECT city_id FROM cities
             WHERE UPPER(name) = UPPER($1)
               AND country_id = $2
               AND state_id = $3
               AND is_deleted = FALSE`,
            [cityName, country_id, state_id]
        );

        if (duplicate.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'City already exists' });
        }

        const insert = await pool.query(
            `INSERT INTO cities (city_uuid, country_id, state_id, name, created_by)
             VALUES (gen_random_uuid(), $1, $2, $3, $4)
             RETURNING *`,
            [country_id, state_id, cityName, created_by]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'City created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (create city):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// LIST CITIES
// --------------------------------------------------
responder.on('list-city', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT * FROM cities
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
        logger.error('Responder Error (list city):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// GET CITY BY UUID
// --------------------------------------------------
responder.on('getById-city', async (req, cb) => {
    try {
        const { city_uuid } = req;

        const result = await pool.query(
            `SELECT * FROM cities
             WHERE city_uuid = $1 AND is_deleted = FALSE`,
            [city_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'City not found' });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        logger.error('Responder Error (getById city):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// UPDATE CITY
// --------------------------------------------------
responder.on('update-city', async (req, cb) => {
    try {
        const { city_uuid, body } = req;
        const { country_id, state_id, name, modified_by,is_active } = body;

        if (!name || !name.trim()) {
            return cb(null, { status: false, code: 2001, error: 'City name is required' });
        }

        const duplicate = await pool.query(
            `SELECT city_uuid FROM cities
             WHERE UPPER(name) = UPPER($1)
               AND country_id = $2
               AND state_id = $3
               AND is_deleted = FALSE
               AND city_uuid != $4`,
            [name.trim(), country_id, state_id, city_uuid]
        );

        if (duplicate.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'City already exists' });
        }

        const update = await pool.query(
            `UPDATE cities SET
                name = $1,
                country_id = $2,
                state_id = $3,
                modified_by = $4,is_active=$5,
                modified_at = NOW()
             WHERE city_uuid = $6
             RETURNING *`,
            [name.trim(), country_id, state_id, modified_by,is_active, city_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'City updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (update city):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// DELETE CITY (SOFT DELETE)
// --------------------------------------------------
responder.on('delete-city', async (req, cb) => {
    try {
        const { city_uuid } = req;
        const { deleted_by } = req.body;

        await pool.query(
            `UPDATE cities SET
                is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
             WHERE city_uuid = $2`,
            [deleted_by, city_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'City deleted successfully'
        });

    } catch (err) {
        logger.error('Responder Error (delete city):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// CITY STATUS CHANGE
// --------------------------------------------------
responder.on('status-city', async (req, cb) => {
    try {
        const { city_uuid } = req;
        const { is_active, modified_by } = req.body;

        await pool.query(
            `UPDATE cities SET
                is_active = $1,
                modified_by = $2,
                modified_at = NOW()
             WHERE city_uuid = $3`,
            [is_active, modified_by, city_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'City status updated successfully'
        });

    } catch (err) {
        logger.error('Responder Error (status city):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// ADVANCED FILTER — CITIES
// --------------------------------------------------
responder.on('advancefilter-city', async (req, cb) => {
    try {

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table: 'cities',
            alias: 'C',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators ON C.created_by = creators.user_uuid
                LEFT JOIN users updaters ON C.modified_by = updaters.user_uuid
                LEFT JOIN states S ON C.state_id = S.state_id
                LEFT JOIN countries CO ON C.country_id = CO.country_id
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'name',
                'country_id',
                'state_id',
                'country_name',
                'state_name',
                'is_active',
                'created_at',
                'modified_at',
                'createdByName',
                'updatedByName'
            ],

            /* ---------------- Custom Joined Fields ---------------- */
            customFields: {
                country_name: {
                    select: 'CO.name',
                    search: 'CO.name',
                    sort: 'CO.name'
                },
                state_name: {
                    select: 'S.name',
                    search: 'S.name',
                    sort: 'S.name'
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
                C.is_deleted = FALSE
            `
        });

        return cb(null, {
            status: true,
            code: 1000,
            result
        });

    } catch (err) {
        console.error('[advancefilter-city] error:', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// CLONE CITY
// --------------------------------------------------
responder.on('clone-city', async (req, cb) => {
    try {
        const { city_uuid } = req;
        const { created_by } = req.body;

        const { rows } = await pool.query(
            `SELECT country_id, state_id, name, is_active
             FROM cities
             WHERE city_uuid = $1 AND is_deleted = FALSE`,
            [city_uuid]
        );

        if (!rows.length) {
            return cb(null, { status: false, code: 2003, error: 'Original city not found' });
        }

        const city = rows[0];

        const clone = await pool.query(
            `INSERT INTO cities (city_uuid, country_id, state_id, name, is_active, created_by)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
             RETURNING *`,
            [city.country_id, city.state_id, city.name + ' (Copy)', city.is_active, created_by]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'City cloned successfully',
            data: clone.rows[0]
        });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
//  FIND CITY BY COUNTRY UUID
// --------------------------------------------------
responder.on('getById-city-countryid', async (req, cb) => {
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
            `SELECT * FROM cities
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
//  FIND CITY BY STATE UUID
// --------------------------------------------------
responder.on('getById-city-stateid', async (req, cb) => {
    try {
        const { state_uuid } = req;

        if (!state_uuid) {
            return cb(null, { status: false, code: 2001, error: 'STATE UUID is required' });
        }

        // 🔹 Get state_id from state table
        const stateResult = await pool.query(
            `SELECT state_id FROM states
             WHERE state_uuid = $1 AND is_deleted = FALSE`,
            [state_uuid]
        );

        if (stateResult.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'State not found' });
        }

        const state_id = stateResult.rows[0].state_id;

        // 🔹 Get states by state_id
        const result = await pool.query(
            `SELECT * FROM cities
             WHERE state_id = $1 AND is_deleted = FALSE`,
            [state_id]
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
        logger.error('Responder Error (getById -stateid):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

