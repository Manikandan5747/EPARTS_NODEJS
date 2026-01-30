require('module-alias/register');

const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// --------------------------------------
// REDIS & COTE RESPONDER
// --------------------------------------
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'trading-types responder',
    key: 'trading-types',
    redis: { host: redisHost, port: redisPort }
});


// --------------------------------------
// CREATE TRADING TYPE
// --------------------------------------
responder.on('create-trading-type', async (req, cb) => {
    try {
        const { code, name, description, created_by, assigned_to } = req.body;

        if (!code || !name) {
            return cb(null, { status: false, code: 2001, error: 'Code and Name are required' });
        }

        // Duplicate check
        const duplicate = await pool.query(
            `SELECT trading_type_id 
             FROM trading_types 
             WHERE (LOWER(code) = LOWER($1) OR LOWER(name) = LOWER($2))
             AND is_deleted = FALSE`,
            [code, name]
        );

        if (duplicate.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Trading Type already exists' });
        }

        const insert = await pool.query(
            `INSERT INTO trading_types
             (trading_type_uuid, code, name, description, created_by, assigned_to)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
             RETURNING *`,
            [code, name, description || null, created_by || null, assigned_to]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Trading Type created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (create trading type):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------
// LIST TRADING TYPES
// --------------------------------------
responder.on('list-trading-type', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT * 
             FROM trading_types
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
        logger.error('Responder Error (list trading types):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------
// GET BY ID
// --------------------------------------
responder.on('getById-trading-type', async (req, cb) => {
    try {
        const { trading_type_uuid } = req;

        const result = await pool.query(
            `SELECT * FROM trading_types
             WHERE trading_type_uuid = $1 AND is_deleted = FALSE`,
            [trading_type_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Trading Type not found' });
        }

        return cb(null, {
            status: true,
            code: 1000,
            data: result.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (getById trading type):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------
// UPDATE TRADING TYPE
// --------------------------------------
responder.on('update-trading-type', async (req, cb) => {
    try {
        const { trading_type_uuid, body } = req;
        const { code, name, description, modified_by } = body;

        if (!code || !name) {
            return cb(null, { status: false, code: 2001, error: 'Code and Name are required' });
        }

        const result = await pool.query(
            `SELECT * FROM trading_types
             WHERE trading_type_uuid = $1 AND is_deleted = FALSE`,
            [trading_type_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Trading Type not found' });
        }

        const duplicate = await pool.query(
            `SELECT trading_type_id 
             FROM trading_types
             WHERE (LOWER(code) = LOWER($1) OR LOWER(name) = LOWER($2))
             AND trading_type_uuid != $3
             AND is_deleted = FALSE`,
            [code, name, trading_type_uuid]
        );

        if (duplicate.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Trading Type already exists' });
        }

        const update = await pool.query(
            `UPDATE trading_types
             SET code = $1,
                 name = $2,
                 description = $3,
                 modified_by = $4,
                 modified_at = NOW()
             WHERE trading_type_uuid = $5
             RETURNING *`,
            [code, name, description || null, modified_by || null, trading_type_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Trading Type updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (update trading type):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------
// DELETE TRADING TYPE (SOFT DELETE)
// --------------------------------------
responder.on('delete-trading-type', async (req, cb) => {
    try {
        const { trading_type_uuid } = req;


        const check = await pool.query(
            `SELECT trading_type_id FROM trading_types
             WHERE trading_type_uuid = $1 AND is_deleted = FALSE`,
            [trading_type_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Trading Type not found' });
        }

        await pool.query(
            `UPDATE trading_types
             SET is_deleted = TRUE,
                 is_active = FALSE,
                 deleted_at = NOW()
             WHERE trading_type_uuid = $1`,
            [trading_type_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Trading Type deleted successfully'
        });

    } catch (err) {
        logger.error('Responder Error (delete trading type):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------
// STATUS CHANGE
// --------------------------------------
responder.on('status-trading-type', async (req, cb) => {
    try {
        const { trading_type_uuid, body } = req;
        const { modified_by } = body;


        const result = await pool.query(
            `SELECT * FROM trading_types
             WHERE trading_type_uuid = $1 AND is_deleted = FALSE`,
            [trading_type_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Trading Type not found' });
        }
        await pool.query(
            `UPDATE trading_types
             SET is_active = NOT is_active,
                 modified_by = $1,
                 modified_at = NOW()
             WHERE trading_type_uuid = $2`,
            [modified_by || null, trading_type_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Trading Type status updated successfully'
        });

    } catch (err) {
        logger.error('Responder Error (status trading type):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------
// ADVANCE FILTER — TRADING TYPES
// --------------------------------------
responder.on('advancefilter-trading-type', async (req, cb) => {
    try {

        const accessScope = req.dataAccessScope;
        let extraWhere = '';
        let extraParams = [];

        // If PRIVATE → only show own created data
        if (accessScope.type === 'PRIVATE') {
            extraWhere = ' AND TT.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            table: 'trading_types',
            alias: 'TT',
            defaultSort: 'created_at',
            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators ON TT.created_by = creators.user_uuid
                LEFT JOIN users updaters ON TT.modified_by = updaters.user_uuid
            `,
            allowedFields: [
                'code', 'name', 'is_active',
                'created_at', 'modified_at', 'createdByName', 'updatedByName'
            ],
            /* -------- Custom joined fields (virtual fields) -------- */
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
                TT.is_deleted = FALSE ${extraWhere}
            `
        });

        return cb(null, {
            status: true,
            code: 1000,
            result
        });

    } catch (err) {
        logger.error('Responder Error (advancefilter trading type):', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

module.exports = responder;
