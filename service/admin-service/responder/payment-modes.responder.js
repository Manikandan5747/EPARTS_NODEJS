require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'payment-modes responder',
    key: 'payment-modes',
    redis: { host: redisHost, port: redisPort }
});


// --------------------------------------------------
// CREATE PAYMENT MODE
// --------------------------------------------------
responder.on('create-payment-mode', async (req, cb) => {
    try {
        const { code, name, description, created_by, assigned_to } = req.body;

        if (!code || !name) {
            return cb(null, { status: false, code: 2001, error: 'Code and Name are required' });
        }

        const check = await pool.query(
            `SELECT payment_mode_id FROM payment_modes 
             WHERE (code = $1 OR LOWER(name) = LOWER($2)) AND is_deleted = FALSE`,
            [code, name]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Payment mode already exists' });
        }

        const insert = await pool.query(
            `INSERT INTO payment_modes (code, name, description, created_by, assigned_to)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [code, name, description, created_by, assigned_to]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Payment mode created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('create-payment-mode error:', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// LIST PAYMENT MODES
// --------------------------------------------------
responder.on('list-payment-mode', async (_, cb) => {
    try {
        const result = await pool.query(
            `SELECT * FROM payment_modes WHERE is_deleted = FALSE ORDER BY created_at DESC`
        );

        return cb(null, {
            status: true,
            code: 1000,
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// GET BY ID
// --------------------------------------------------
responder.on('getById-payment-mode', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT * FROM payment_modes 
             WHERE payment_mode_uuid = $1 AND is_deleted = FALSE`,
            [req.payment_mode_uuid]
        );

        if (!result.rowCount) {
            return cb(null, { status: false, code: 2003, error: 'Payment mode not found' });
        }

        return cb(null, { status: true, code: 1000, data: result.rows[0] });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// UPDATE PAYMENT MODE
// --------------------------------------------------
responder.on('update-payment-mode', async (req, cb) => {
    try {
        const { payment_mode_uuid, body } = req;
        const { code, name, description, modified_by } = body;

         const result = await pool.query(
            `SELECT * FROM payment_modes 
             WHERE payment_mode_uuid = $1 AND is_deleted = FALSE`,
            [payment_mode_uuid]
        );

        if (!result.rowCount) {
            return cb(null, { status: false, code: 2003, error: 'Payment mode not found' });
        }

        const update = await pool.query(
            `UPDATE payment_modes
             SET code = $1, name = $2, description = $3,
                 modified_by = $4, modified_at = NOW()
             WHERE payment_mode_uuid = $5
             RETURNING *`,
            [code, name, description, modified_by, payment_mode_uuid]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: 'Payment mode updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// DELETE PAYMENT MODE
// --------------------------------------------------
responder.on('delete-payment-mode', async (req, cb) => {
    try {

         const result = await pool.query(
            `SELECT * FROM payment_modes 
             WHERE payment_mode_uuid = $1 AND is_deleted = FALSE`,
            [req.payment_mode_uuid]
        );

        if (!result.rowCount) {
            return cb(null, { status: false, code: 2003, error: 'Payment mode not found' });
        }

        await pool.query(
            `UPDATE payment_modes
             SET is_deleted = TRUE, is_active = FALSE,
                 deleted_by = $1, deleted_at = NOW()
             WHERE payment_mode_uuid = $2`,
            [req.body.deleted_by, req.payment_mode_uuid]
        );

        return cb(null, { status: true, code: 1000, message: 'Payment mode deleted successfully' });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// STATUS CHANGE
// --------------------------------------------------
responder.on('status-payment-mode', async (req, cb) => {
    try {

           const result = await pool.query(
            `SELECT * FROM payment_modes 
             WHERE payment_mode_uuid = $1 AND is_deleted = FALSE`,
            [req.payment_mode_uuid]
        );

        if (!result.rowCount) {
            return cb(null, { status: false, code: 2003, error: 'Payment mode not found' });
        }
        
        await pool.query(
            `UPDATE payment_modes
             SET is_active = NOT is_active,
                 modified_by = $1, modified_at = NOW()
             WHERE payment_mode_uuid = $2`,
            [req.body.modified_by, req.payment_mode_uuid]
        );

        return cb(null, { status: true, code: 1000, message: 'Status updated successfully' });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------------
// ADVANCE FILTER
// --------------------------------------------------
responder.on('advancefilter-payment-mode', async (req, cb) => {
    try {
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,
            table: 'payment_modes',
            alias: 'PM',
            defaultSort: 'created_at',
            allowedFields: ['code', 'name', 'is_active', 'created_at'],
            baseWhere: 'PM.is_deleted = FALSE'
        });

        return cb(null, { status: true, code: 1000, result });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});
