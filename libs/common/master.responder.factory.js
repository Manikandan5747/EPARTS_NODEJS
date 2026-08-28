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
                header_type: "SUCCESS", //'SUCCESS' | 'VALIDATION' | 'ERROR' | 'WARNING' | 'INFO'
                status: true,
                code: 1000,
                message: `${formatTableName(table)} created successfully`,
                data: result.rows[0],
                message_visibility: true
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
                    header_type: "VALIDATION", //'SUCCESS' | 'VALIDATION' | 'ERROR' | 'WARNING' | 'INFO'
                    status: false,
                    code: 2002,
                    message: "Duplicate value. This record already exists.",
                    message_visibility: true,
                    error: detail
                });
            }

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
                header_type: "SUCCESS",
                message_visibility: false,
                status: true,
                code: 1000,
                message: `${formatTableName(table)} list fetched successfully`,
                count: result.rowCount,
                data: result.rows
            });
        } catch (err) {
            logger.error(`Error (list ${table}):`, err);
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

    responder.on(api('getById'), async (req, cb) => {
        const client = await pool.connect();
        const LOCK_DURATION_MIN = 1; // minutes

        try {
            const uuid = req[uuidColumn] || req.uuid;
            const mode = req.mode;
            const user_id = req.body?.user_id;

            await client.query('BEGIN');

            // -----------------------------
            // 1️⃣ Build Dynamic SELECT
            // -----------------------------
            const selectCustomFields = Object.entries(customFields || {})
                .map(([key, value]) => `${value.select} AS "${key}"`)
                .join(', ');

            const fullJoinSql = `
            ${joinSql || ''}
            LEFT JOIN users creators 
                ON ${alias}.created_by = creators.user_uuid
            LEFT JOIN users updaters 
                ON ${alias}.modified_by = updaters.user_uuid
        `;

            // -----------------------------
            // 2️⃣ Fetch Main Record
            // -----------------------------
            const { rows, rowCount } = await client.query(
                `
            SELECT 
                ${alias}.*,
                ${selectCustomFields ? selectCustomFields + ',' : ''}
                creators.username AS "createdByName",
                updaters.username AS "updatedByName"
            FROM ${table} ${alias}
            ${fullJoinSql}
            WHERE ${alias}.${uuidColumn} = $1
              AND ${alias}.is_deleted = FALSE
            `,
                [uuid]
            );

            if (!rowCount) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type: "ERROR",
                    status: false,
                    code: 2003,
                    message: `${formatTableName(table)} not found`
                });
            }

            const row = rows[0];

            // -----------------------------
            // 3️⃣ Check Existing Lock
            // -----------------------------
            const lockResult = await client.query(
                `
            SELECT RL.*, U.username AS locked_by_name
            FROM record_locks RL
            LEFT JOIN users U ON U.user_uuid = RL.locked_by
            WHERE RL.table_name = $1
              AND RL.record_id = $2
              AND RL.is_deleted = FALSE
            `,
                [table, uuid]
            );

            let lockRow = lockResult.rows[0];

            const isExpired =
                lockRow &&
                new Date(lockRow.expires_at).getTime() < Date.now();

            // -----------------------------
            // 4️⃣ EDIT MODE Locking Logic
            // -----------------------------
            if (mode === 'edit') {

                if (!user_id) {
                    await client.query('ROLLBACK');
                    return cb(null, {
                        header_type: "ERROR",
                        status: false,
                        code: 2001,
                        message: "User ID required for edit"
                    });
                }

                // ❌ Locked by another user and NOT expired
                if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                    await client.query('ROLLBACK');
                    return cb(null, {
                        header_type: "ERROR",
                        status: false,
                        code: 2008,
                        message: `Record locked by ${lockRow.locked_by_name || 'another user'}`,
                        error: "LOCKED"
                    });
                }

                // 🔄 Soft delete expired lock
                if (lockRow && isExpired) {
                    await client.query(
                        `
                    UPDATE record_locks
                    SET is_deleted = TRUE
                    WHERE lock_id = $1
                    `,
                        [lockRow.lock_id]
                    );
                    lockRow = null;
                }

                // 🔒 Create new lock if none exists
                if (!lockRow) {
                    const insertLock = await client.query(
                        `
                    INSERT INTO record_locks (
                        table_name,
                        record_id,
                        locked_by,
                        expires_at,
                        created_by
                    )
                    VALUES (
                        $1,
                        $2,
                        $3,
                        NOW() + INTERVAL '${LOCK_DURATION_MIN} minute',
                        $3
                    )
                    RETURNING *
                    `,
                        [table, uuid, user_id]
                    );

                    lockRow = insertLock.rows[0];
                }
            }

            await client.query('COMMIT');

            // -----------------------------
            // 5️⃣ Attach Lock Info to Response
            // -----------------------------
            row.lock_status =
                lockRow &&
                new Date(lockRow.expires_at).getTime() >= Date.now();

            row.locked_by = lockRow?.locked_by || null;

            return cb(null, {
                header_type: "SUCCESS",
                status: true,
                code: 1000,
                message: `${formatTableName(table)} fetched successfully`,
                data: row
            });

        } catch (err) {
            await client.query('ROLLBACK');

            return cb(null, {
                header_type: "ERROR",
                status: false,
                code: 2004,
                message: err.message
            });

        } finally {
            client.release();
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
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2003,
                    message: `${formatTableName(table)} not found`,
                    error: `${formatTableName(table)} not found`
                });
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
                header_type: "SUCCESS", //'SUCCESS' | 'VALIDATION' | 'ERROR' | 'WARNING' | 'INFO'
                message_visibility: true,
                status: true,
                code: 1000,
                message: `${formatTableName(table)} updated successfully`,
                data: result.rows[0]
            });
        } catch (err) {
            logger.error(`Error (update ${table}):`, err);
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
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2003,
                    error: `${table} not found`,
                    message: `${formatTableName(table)} not found`,
                });
            }

            await pool.query(
                `UPDATE ${table} SET is_deleted = TRUE, is_active = FALSE, deleted_at = NOW(), deleted_by = $1 WHERE ${uuidColumn} = $2`,
                [deleted_by, uuid]
            );

            return cb(null, {
                header_type: "SUCCESS", //'SUCCESS' | 'VALIDATION' | 'ERROR' | 'WARNING' | 'INFO'
                message_visibility: true,
                status: true,
                code: 1000,
                message: `${formatTableName(table)} deleted successfully`
            });
        } catch (err) {
            logger.error(`Error (delete ${table}):`, err);
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
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    message: `${formatTableName(table)} not found`,
                    status: false,
                    code: 2003,
                    error: `${table} not found`
                });
            }

            const result = await pool.query(
                `UPDATE ${table} SET is_active = $1, modified_at = NOW(), modified_by = $2 WHERE ${uuidColumn} = $3 RETURNING *`,
                [isActive, modified_by, uuid]
            );

            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 1000,
                message: `${formatTableName(table)} status updated successfully`,
                data: result.rows[0]
            });
        } catch (err) {
            logger.error(`Error (status ${table}):`, err);
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
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 1000,
                message: `${formatTableName(table)} list fetched successfully`,
                result
            });

        } catch (err) {
            logger.error(`Error (advancefilter ${table}):`, err);
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

            if (key == 'cities') {
                const stateResult = await pool.query(
                    `SELECT state_id FROM states
             WHERE state_uuid = $1 AND is_deleted = FALSE`, [req.state_uuid]);

                if (stateResult.rowCount === 0) {
                    return cb(null, {
                        status: false,
                        code: 2003,
                        error: "State not found"
                    });
                }

                const state_id = stateResult.rows[0].state_id;
                whereSql += ` AND ${alias}.state_id = ${state_id}`;
            }
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
                header_type: "SUCCESS",
                message_visibility: false,
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
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2004,
                message: err.message,
                error: err.message
            });
        }
    });



    responder.on(`lock-${key}`, async (req, cb) => {
        const client = await pool.connect();
        try {
            const { uuid } = req;
            const { user_id } = req.body;

            if (!user_id) {
                return cb(null, {
                    status: false,
                    code: 2001,
                    error: 'User ID required'
                });
            }

            await client.query('BEGIN');

            // Check existing lock
            const { rows } = await client.query(
                `
            SELECT locked_by, locked_at
            FROM ${table}
            WHERE ${uuidColumn} = $1
            FOR UPDATE
            `,
                [uuid]
            );

            if (!rows.length) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: false,
                    status: false,
                    code: 2004,
                    message: 'Record not found',
                    error: 'Record not found'
                });
            }

            const { locked_by, locked_at } = rows[0];

            // Auto-unlock logic (1 min)
            const isExpired =
                locked_at &&
                new Date(locked_at).getTime() + 1 * 60 * 1000 < Date.now();

            if (locked_by && locked_by !== user_id && !isExpired) {
                await client.query('ROLLBACK');
                return cb(null, {
                    status: false,
                    code: 2008,
                    error: 'Record is locked by another user'
                });
            }

            // Lock record
            await client.query(
                `
            UPDATE ${table}
            SET locked_by = $1,
                locked_at = NOW()
            WHERE ${uuidColumn} = $2
            `,
                [user_id, uuid]
            );

            await client.query('COMMIT');

            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: false,
                status: true, code: 1000,
                message: `${formatTableName(table)} Record locked successfully`,
            });

        } catch (err) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2004,
                message: err.message,
                error: err.message
            });
        } finally {
            client.release();
        }
    });


    responder.on(`unlock-${key}`, async (req, cb) => {
        try {
            const { uuid } = req;
            const { user_id } = req.body;

            const result = await pool.query(
                `
            UPDATE ${table}
            SET locked_by = NULL,
                locked_at = NULL
            WHERE ${uuidColumn} = $1
              AND locked_by = $2
            `,
                [uuid, user_id]
            );

            if (!result.rowCount) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2003,
                    message: 'Unable to unlock record',
                    error: 'This record is currently being edited by another user'
                });
            }

            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: false,
                status: true,
                code: 1000,
                message: `${formatTableName(table)} Record unlocked successfully`,
            });

        } catch (err) {
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

};
