const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');
const logger = require('@libs/logger/logger');



module.exports = function registerMasterResponder({
    responder,
    pool,
    key,
    table,
    alias,
    uuidColumn = 'uuid', // default column name
    allowedFields = [],
    joinSql = ''
}) {

    const api = (action) => `${action}-${key}`;

     console.log("api res",api('create'));

    // ---------------- CREATE ----------------
    responder.on(api('create'), async (req, cb) => {
        try {
            const columns = Object.keys(req.body);
            const values = Object.values(req.body);

            const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');

            const insertSQL = `
                INSERT INTO ${table} (${columns.join(',')})
                VALUES (${placeholders})
                RETURNING *
            `;

            const result = await pool.query(insertSQL, values);

            return cb(null, {
                status: true,
                code: 1000,
                message: `${table} created successfully`,
                data: result.rows[0]
            });
        } catch (err) {
            logger.error(`Error (create ${table}):`, err);
            return cb(null, { status: false, code: 2004, error: err.message });
        }
    });

    // ---------------- LIST ----------------
    responder.on(api('list'), async (req, cb) => {
        try {
            const listSQL = `
                SELECT ${alias}.*, creators.username as createdByName, updaters.username as updatedByName
                FROM ${table} ${alias}
                LEFT JOIN users creators ON ${alias}.created_by = creators.user_uuid
                LEFT JOIN users updaters ON ${alias}.modified_by = updaters.user_uuid
                ${joinSql}
                WHERE ${alias}.is_deleted = FALSE
                ORDER BY ${alias}.created_at ASC
            `;

            const result = await pool.query(listSQL);

            return cb(null, {
                status: true,
                code: 1000,
                message: `${table} list fetched successfully`,
                count: result.rowCount,
                data: result.rows
            });
        } catch (err) {
            logger.error(`Error (list ${table}):`, err);
            return cb(null, { status: false, code: 2004, error: err.message });
        }
    });

    // ---------------- GET BY ID ----------------
    responder.on(api('getById'), async (req, cb) => {
        try {
            const uuid = req[uuidColumn] || req.uuid;
            const result = await pool.query(
                `SELECT * FROM ${table} WHERE ${uuidColumn} = $1 AND is_deleted = FALSE`,
                [uuid]
            );

            if (result.rowCount === 0) {
                return cb(null, { status: false, code: 2003, error: `${table} not found` });
            }

            return cb(null, { status: true, code: 1000, data: result.rows[0] });
        } catch (err) {
            logger.error(`Error (getById ${table}):`, err);
            return cb(null, { status: false, code: 2004, error: err.message });
        }
    });

    // ---------------- UPDATE ----------------
    responder.on(api('update'), async (req, cb) => {
        try {
            const uuid = req[uuidColumn] || req.uuid;
            const body = req.body;

            const columns = Object.keys(body);
            const values = Object.values(body);

            const setQuery = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');

            const updateSQL = `
                UPDATE ${table}
                SET ${setQuery}, modified_at = NOW()
                WHERE ${uuidColumn} = $${columns.length + 1}
                RETURNING *
            `;

            const result = await pool.query(updateSQL, [...values, uuid]);

            return cb(null, {
                status: true,
                code: 1000,
                message: `${table} updated successfully`,
                data: result.rows[0]
            });
        } catch (err) {
            logger.error(`Error (update ${table}):`, err);
            return cb(null, { status: false, code: 2004, error: err.message });
        }
    });

    // ---------------- DELETE ----------------
    responder.on(api('delete'), async (req, cb) => {
        try {
            const uuid = req[uuidColumn] || req.uuid;
            const deleted_by = req.body?.deleted_by || null;

            const check = await pool.query(
                `SELECT * FROM ${table} WHERE ${uuidColumn} = $1 AND is_deleted = FALSE`,
                [uuid]
            );

            if (check.rowCount === 0) {
                return cb(null, { status: false, code: 2003, error: `${table} not found` });
            }

            await pool.query(
                `UPDATE ${table} SET is_deleted = TRUE, is_active = FALSE, deleted_at = NOW(), deleted_by = $1 WHERE ${uuidColumn} = $2`,
                [deleted_by, uuid]
            );

            return cb(null, {
                status: true,
                code: 1000,
                message: `${table} deleted successfully`
            });
        } catch (err) {
            logger.error(`Error (delete ${table}):`, err);
            return cb(null, { status: false, code: 2004, error: err.message });
        }
    });

    // ---------------- STATUS ----------------
    responder.on(api('status'), async (req, cb) => {
        try {
            const uuid = req[uuidColumn] || req.uuid;
            const isActive = req.body?.is_active;
            const modified_by = req.body?.modified_by;

            const result = await pool.query(
                `UPDATE ${table} SET is_active = $1, modified_at = NOW(), modified_by = $2 WHERE ${uuidColumn} = $3 RETURNING *`,
                [isActive, modified_by, uuid]
            );

            return cb(null, {
                status: true,
                code: 1000,
                message: `${table} status updated successfully`,
                data: result.rows[0]
            });
        } catch (err) {
            logger.error(`Error (status ${table}):`, err);
            return cb(null, { status: false, code: 2004, error: err.message });
        }
    });

    // ---------------- ADVANCE FILTER ----------------
    responder.on(`advancefilter-${table}`, async (req, cb) => {
        try {
            const result = await buildAdvancedSearchQuery({
                pool,
                reqBody: req.body,
                table,
                alias,
                defaultSort: 'created_at',
                allowedFields,
                joinSql,
                baseWhere: `${alias}.is_deleted = FALSE`
            });

            return cb(null, { status: true, code: 1000, result });
        } catch (err) {
            logger.error(`Error (advancefilter ${table}):`, err);
            return cb(null, { status: false, code: 2004, error: err.message });
        }
    });

    // ---------------- CLONE ----------------
    responder.on(api('clone'), async (req, cb) => {
        try {
            const uuid = req[uuidColumn] || req.uuid;
            const created_by = req.body?.created_by || null;

            const fetchSQL = `SELECT * FROM ${table} WHERE ${uuidColumn} = $1 AND is_deleted = FALSE`;
            const { rows } = await pool.query(fetchSQL, [uuid]);

            if (!rows.length) {
                return cb(null, { status: false, code: 2003, error: `${table} not found` });
            }

            const record = rows[0];
            delete record[uuidColumn];
            delete record.created_at;
            delete record.modified_at;
            delete record.deleted_at;
            delete record.deleted_by;

            record.created_by = created_by;

            const columns = Object.keys(record);
            const values = Object.values(record);

            const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');

            const insertSQL = `
                INSERT INTO ${table} (${columns.join(',')})
                VALUES (${placeholders})
                RETURNING *
            `;

            const cloned = await pool.query(insertSQL, values);

            return cb(null, {
                status: true,
                code: 1000,
                message: `${table} cloned successfully`,
                data: cloned.rows[0]
            });

        } catch (err) {
            logger.error(`Error (clone ${table}):`, err);
            return cb(null, { status: false, code: 2004, error: err.message });
        }
    });

};
