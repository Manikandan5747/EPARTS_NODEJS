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
    joinSql = '',
    dateFields = [],
    customFields = [],
    searchableFields = [],
}) {

    searchableFields = (searchableFields && searchableFields.length > 0)
        ? searchableFields
        : ['code', 'name'];

    const api = (action) => `${action}-${key}`;

    console.log("api res", api('create'));

    const formatTableName = (name) =>
        name
            .replace(/_/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase());

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
                message: `${formatTableName(table)} created successfully`,
                data: result.rows[0]
            });

        } catch (err) {
            logger.error(`Error (create ${table}):`, err);
            console.log("err.code", err.code);


            if (err.code === '23505') {
                let detail = "Duplicate value.";

                // Parse Postgres detail: "Key (name)=(USD) already exists."
                if (err.detail) {
                    const match = err.detail.match(/\((.*?)\)=/);
                    if (match) {
                        detail = `${match[1]} already exists.`;
                    }
                }

                return cb(null, {
                    status: false,
                    code: 2002,
                    message: "Duplicate value. This record already exists.",
                    error: detail
                });
            }

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
                message: `${formatTableName(table)} list fetched successfully`,
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

            return cb(null, {
                status: true,
                message: `${formatTableName(table)} fetched successfully`, code: 1000, data: result.rows[0]
            });
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


            const check = await pool.query(
                `SELECT * FROM ${table} WHERE ${uuidColumn} = $1 AND is_deleted = FALSE`,
                [uuid]
            );

            if (check.rowCount === 0) {
                return cb(null, { status: false, code: 2003, error: `${formatTableName(table)} not found` });
            }

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
                message: `${formatTableName(table)} updated successfully`,
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
                message: `${formatTableName(table)} deleted successfully`
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


            const check = await pool.query(
                `SELECT * FROM ${table} WHERE ${uuidColumn} = $1 AND is_deleted = FALSE`,
                [uuid]
            );

            if (check.rowCount === 0) {
                return cb(null, { status: false, code: 2003, error: `${table} not found` });
            }

            const result = await pool.query(
                `UPDATE ${table} SET is_active = $1, modified_at = NOW(), modified_by = $2 WHERE ${uuidColumn} = $3 RETURNING *`,
                [isActive, modified_by, uuid]
            );

            return cb(null, {
                status: true,
                code: 1000,
                message: `${formatTableName(table)} status updated successfully`,
                data: result.rows[0]
            });
        } catch (err) {
            logger.error(`Error (status ${table}):`, err);
            return cb(null, { status: false, code: 2004, error: err.message });
        }
    });

    // ---------------- ADVANCE FILTER ----------------
    // responder.on(api('advancefilter'), async (req, cb) => {
    //     try {

    //         const accessScope = req.dataAccessScope;
    //         let extraWhere = '';
    //         let extraParams = [];

    //         // If PRIVATE → only show own created data
    //         if (accessScope.type === 'PRIVATE') {
    //             extraWhere = ` AND ${alias}.created_by = $extraUser`;
    //             extraParams.push(accessScope.user_id);
    //         }

    //         // Define joins dynamically if needed
    //         const joinSQL = `
    //         LEFT JOIN users creators ON ${alias}.created_by = creators.user_uuid
    //         LEFT JOIN users updaters ON ${alias}.modified_by = updaters.user_uuid
    //     `;

    //         const result = await buildAdvancedSearchQuery({
    //             pool,
    //             reqBody: req.body,
    //             table,
    //             alias,
    //             defaultSort: 'created_at',
    //             allowedFields,
    //             joinSql: joinSQL,      // pass joins here
    //             baseWhere: `${alias}.is_deleted = FALSE ${extraWhere}`,
    //             customFields: {        // optional virtual fields
    //                 createdByName: {
    //                     select: 'creators.username',
    //                     search: 'creators.username',
    //                     sort: 'creators.username'
    //                 },
    //                 updatedByName: {
    //                     select: 'updaters.username',
    //                     search: 'updaters.username',
    //                     sort: 'updaters.username'
    //                 }
    //             }
    //         });

    //         return cb(null, {
    //             status: true, code: 1000,
    //             message: `${formatTableName(table)} list fetched successfully`,
    //             result
    //         });

    //     } catch (err) {
    //         logger.error(`Error (advancefilter ${table}):`, err);
    //         return cb(null, { status: false, code: 2004, error: err.message });
    //     }
    // });

    // ---------------- ADVANCE FILTER ----------------
    responder.on(api('advancefilter'), async (req, cb) => {
        try {

            const accessScope = req.dataAccessScope;
            let extraWhere = '';
            let extraParams = [];

            // If PRIVATE → only show own created data
            if (accessScope?.type === 'PRIVATE') {
                extraWhere = ` AND ${alias}.created_by = $1`;
                extraParams.push(accessScope.user_id);
            }

            // Dynamic joins
            const joinSQL = `
            ${joinSql}
            LEFT JOIN users creators ON ${alias}.created_by = creators.user_uuid
            LEFT JOIN users updaters ON ${alias}.modified_by = updaters.user_uuid
        `;

            const result = await buildAdvancedSearchQuery({
                pool,
                reqBody: req.body,
                table,
                alias,
                defaultSort: 'created_at',
                allowedFields,
                joinSql: joinSQL,

                baseWhere: `
                ${alias}.is_deleted = FALSE
                ${extraWhere}
            `,

                baseParams: extraParams,
                dateFields: dateFields,
                customFields: {
                    ...customFields,
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
                }
            });

            return cb(null, {
                status: true,
                code: 1000,
                message: `${formatTableName(table)} list fetched successfully`,
                result
            });

        } catch (err) {
            logger.error(`Error (advancefilter ${table}):`, err);
            return cb(null, {
                status: false,
                code: 2004,
                error: err.message
            });
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

    /* ======================================================
     LIST + SEARCH + PAGINATION (COMMON FOR ALL MASTERS)
  ====================================================== */
    responder.on(`${key}-listpagination`, async (req, cb) => {
        try {

            // let searchableFields = ['code', 'name'];
            const {
                search = '',
                page = 1,
                limit = 10
            } = req;

            const pageNo = parseInt(page, 10);
            const limitNo = parseInt(limit, 10);
            const offset = (pageNo - 1) * limitNo;

            let whereSql = `WHERE ${alias}.is_deleted = FALSE`;
            let params = [];
            let idx = 1;

            /* -------- SEARCH (SAFE) -------- */
            if (search && searchableFields.length) {
                const conditions = searchableFields.map(
                    field => `LOWER(${alias}.${field}) LIKE LOWER($${idx})`
                );
                whereSql += ` AND (${conditions.join(' OR ')})`;
                params.push(`%${search}%`);
                idx++;
            }


            /* -------- COUNT -------- */
            const countQuery = `
                SELECT COUNT(*) AS total
                FROM ${table} ${alias}
                ${joinSql}
                ${whereSql}
            `;

            const countResult = await pool.query(countQuery, params);
            const totalRecords = parseInt(countResult.rows[0].total, 10);

            /* -------- DATA -------- */
            params.push(limitNo, offset);

            const dataQuery = `
                SELECT ${alias}.*
                FROM ${table} ${alias}
                ${joinSql}
                ${whereSql}
                ORDER BY ${alias}.created_at DESC
                LIMIT $${idx} OFFSET $${idx + 1}
            `;

            const result = await pool.query(dataQuery, params);

            return cb(null, {
                status: true,
                code: 1000,
                message: `${formatTableName(table)} list fetched successfully`,
                data: {
                    count: result.rowCount,
                    total: totalRecords,
                    page: pageNo,
                    limit: limitNo,
                    data: result.rows
                }
            });

        } catch (err) {
            logger.error(`Error (${key}-listpagination):`, err);
            return cb(null, {
                status: false,
                code: 2004,
                error: err.message
            });
        }
    });

};
