const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

const responder = new cote.Responder({
    name: 'currency responder',
    key: 'currency'
});

// --------------------------------------
// CREATE CURRENCY
// --------------------------------------
responder.on('create-currency', async (req, cb) => {
    try {
        const { code, name, symbol, description, created_by } = req.body;

        if (!name || !name.trim()) {
            return cb(null, { status: false, code: 2001, error: 'Currency name is required' });
        }

        if (!code || !code.trim()) {
            return cb(null, { status: false, code: 2001, error: 'Code is required' });
        }

        // CHECK DUPLICATE COUNTRY
        const check = await pool.query(
            `SELECT currency_id FROM currency
              WHERE UPPER(name) = UPPER($1) AND is_deleted = FALSE`,
            [name.trim()]
        );

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Currency already exists' });
        }


        const query = `
            INSERT INTO currency (code, name, symbol, description, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;

        const { rows } = await pool.query(query, [
            code, name, symbol, description, created_by
        ]);

        cb(null, { status: true, code: 1000, result: rows[0] });

    } catch (err) {
        logger.error('[create-currency]', err);
        cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------
// LIST CURRENCY
// --------------------------------------
responder.on('list-currency', async (req, cb) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM currency WHERE is_deleted = FALSE ORDER BY created_at DESC`
        );
        cb(null, { status: true, code: 1000, result: rows });
    } catch (err) {
        cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------
// GET BY ID
// --------------------------------------
responder.on('getById-currency', async (req, cb) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM currency WHERE currency_uuid = $1 AND is_deleted = FALSE`,
            [req.currency_uuid]
        );
        cb(null, { status: true, code: 1000, result: rows[0] });
    } catch (err) {
        cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------
// UPDATE CURRENCY
// --------------------------------------
responder.on('update-currency', async (req, cb) => {
    try {
        const { code, name, symbol, description, modified_by, is_active } = req.body;
        const currency_uuid = req.currency_uuid;

        // --------------------------------------
        // 🔍 DUPLICATE CHECK
        // --------------------------------------
        const duplicateQuery = `
      SELECT currency_id 
      FROM currency
      WHERE 
        (
          LOWER(code) = LOWER($1)
          OR LOWER(name) = LOWER($2)
        )
        AND is_deleted = FALSE
        AND currency_uuid != $3
    `;

        const dup = await pool.query(duplicateQuery, [
            code.trim(),
            name.trim(),
            currency_uuid
        ]);

        if (dup.rowCount > 0) {
            return cb(null, {
                status: false,
                code: 2003,
                message: "Currency code or name already exists"
            });
        }

        // --------------------------------------
        // ✅ UPDATE
        // --------------------------------------
        const updateQuery = `
      UPDATE currency
      SET 
        code = $1,
        name = $2,
        symbol = $3,
        description = $4,
        modified_by = $5,is_active=$6,
        modified_at = NOW()
      WHERE currency_uuid = $7
        AND is_deleted = FALSE
      RETURNING *
    `;

        const { rows } = await pool.query(updateQuery, [
            code.trim(),
            name.trim(),
            symbol,
            description,
            modified_by, is_active,
            currency_uuid
        ]);

        if (rows.length === 0) {
            return cb(null, {
                status: false,
                code: 2004,
                message: "Currency not found or deleted"
            });
        }

        cb(null, { status: true, code: 1000, result: rows[0] });

    } catch (err) {
        cb(null, { status: false, code: 5000, error: err.message });
    }
});


// --------------------------------------
// DELETE CURRENCY (SOFT)
// --------------------------------------
responder.on('delete-currency', async (req, cb) => {
    try {
        await pool.query(
            `UPDATE currency
             SET is_deleted=TRUE, deleted_at=NOW()
             WHERE currency_uuid=$1`,
            [req.currency_uuid]
        );
        cb(null, { status: true, code: 1000 });
    } catch (err) {
        cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------
// STATUS CHANGE
// --------------------------------------
responder.on('status-currency', async (req, cb) => {
    try {
        const { is_active } = req.body;
        await pool.query(
            `UPDATE currency
             SET is_active=$1, modified_at=NOW()
             WHERE currency_uuid=$2`,
            [is_active, req.currency_uuid]
        );
        cb(null, { status: true, code: 1000 });
    } catch (err) {
        cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------
// ADVANCE FILTER
// --------------------------------------
responder.on('advancefilter-currency', async (req, cb) => {
    try {

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,
            table: 'currency',
            alias: 'CU',
            defaultSort: 'created_at',

            joinSql: `
                LEFT JOIN users creators ON CU.created_by = creators.user_uuid
                LEFT JOIN users updaters ON CU.modified_by = updaters.user_uuid
            `,

            allowedFields: [
                'code', 'name', 'symbol',
                'is_active', 'created_at', 'modified_at',
                'createdByName', 'updatedByName'
            ],

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

            baseWhere: `CU.is_deleted = FALSE`
        });

        cb(null, { status: true, code: 1000, result });

    } catch (err) {
        cb(null, { status: false, code: 2004, error: err.message });
    }
});
