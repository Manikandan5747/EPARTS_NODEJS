require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');


// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'subgroup_parts responder',
    key: 'subgroup_parts',
    redis: { host: redisHost, port: redisPort }
});


// ================================================================
// Generate next sub_group_part code
// ================================================================

async function generateNextSubGroupPartCode(pool) {
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM prefix_refno
         WHERE table_name = 'sub_group_parts'
         AND is_active  = true
         AND is_deleted = false
         ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = prefixRes.rows[0]?.prefix_code || "SGP";

    const result = await pool.query(
        `SELECT code FROM sub_group_parts
         WHERE code IS NOT NULL
         AND is_deleted = FALSE
         ORDER BY (regexp_replace(code, '\\D', '', 'g'))::int DESC
         LIMIT 1`
    );

    const lastCode = result.rows[0]?.code;
    if (!lastCode) return `${prefix}00001`;

    const match  = lastCode.match(/\d+$/);
    const number = match ? parseInt(match[0], 10) : 0;
    return `${prefix}${(number + 1).toString().padStart(5, "0")}`;
}


// ================================================================
// CREATE SUB GROUP PART
// ================================================================

responder.on("create-sub-group-part", async (req, cb) => {
    try {
        const {
            sub_group_uuid,
            part_uuid,
            diagram_ref_no,
            qty,
            position_x,
            position_y,
            anchor_x,
            anchor_y,
            marker_type,
            is_clickable,
            notes,
            display_order,
            created_by
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!sub_group_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Sub Group UUID is required"
            });
        }

        if (!part_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Part UUID is required"
            });
        }

        if (!created_by) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Created by is required"
            });
        }

        // -----------------------------
        // FETCH sub_group_id FROM sub_group_uuid
        // -----------------------------
        const subGroupResult = await pool.query(
            `SELECT sub_group_id FROM sub_groups
             WHERE sub_group_uuid = $1
               AND is_deleted = FALSE`,
            [sub_group_uuid]
        );

        if (subGroupResult.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid Sub Group UUID"
            });
        }

        const sub_group_id = subGroupResult.rows[0].sub_group_id;

        // -----------------------------
        // FETCH part_id FROM part_uuid
        // -----------------------------
        const partResult = await pool.query(
            `SELECT part_id FROM parts
             WHERE part_uuid  = $1
               AND is_deleted = FALSE
               AND is_active  = TRUE`,
            [part_uuid]
        );

        if (partResult.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid Part UUID"
            });
        }

        const part_id = partResult.rows[0].part_id;

        // -----------------------------
        // DUPLICATE CHECK
        // -----------------------------
        const duplicateCheck = await pool.query(
            `SELECT id FROM sub_group_parts
             WHERE sub_group_id = $1
               AND part_id      = $2
               AND is_deleted   = FALSE`,
            [sub_group_id, part_id]
        );

        if (duplicateCheck.rowCount > 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Creation failed",
                error: "This part is already mapped"
            });
        }

        // -----------------------------
        // AUTO-GENERATE CODE
        // -----------------------------
        const sub_group_part_code = await generateNextSubGroupPartCode(pool);

        // -----------------------------
        // INSERT SUB GROUP PART
        // -----------------------------
        const insertQuery = {
            text: `
                INSERT INTO sub_group_parts
                    (
                        code,
                        sub_group_id,
                        part_id,
                        diagram_ref_no,
                        qty,
                        position_x,
                        position_y,
                        anchor_x,
                        anchor_y,
                        marker_type,
                        is_clickable,
                        notes,
                        display_order,
                        created_by,
                        assigned_to,
                        assigned_at
                    )
                VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, NOW())
                RETURNING *
            `,
            values: [
                sub_group_part_code,
                sub_group_id,
                part_id,
                diagram_ref_no,
                qty,
                position_x,
                position_y,
                anchor_x,
                anchor_y,
                marker_type,
                is_clickable,
                notes,
                display_order,
                created_by        
            ]
        };

        const insert = await pool.query(insertQuery);

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Sub group part created successfully",
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (create-sub-group-part):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Internal server error",
            error: err.message
        });
    }
});


// ================================================================
// GET SUB GROUP PART BY UUID (WITH EDIT LOCKING)
// ================================================================

responder.on('getById-sub-group-part', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { sub_group_parts_uuid } = req;
        const mode    = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!sub_group_parts_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Sub Group Part UUID is required"
            });
        }

        await client.query('BEGIN');

        // -----------------------------
        // FETCH SUB GROUP PART BY UUID
        // -----------------------------
        const result = await client.query(
            `
            SELECT
                SGP.id,
                SGP.sub_group_parts_uuid,
                SGP.code,
                SGP.sub_group_id,
                SGP.part_id,
                SGP.diagram_ref_no,
                SGP.qty,
                SGP.position_x,
                SGP.position_y,
                SGP.anchor_x,
                SGP.anchor_y,
                SGP.marker_type,
                SGP.is_clickable,
                SGP.notes,
                SGP.display_order,
                SGP.assigned_to,
                SGP.assigned_at,
                SGP.created_at,
                SGP.created_by,
                SGP.modified_at,
                SGP.modified_by,
                SGP.is_deleted,
                -- Sub Group info
                SG.sub_group_uuid,
                SG.name          AS sub_group_name,
                -- Part info
                P.part_uuid,
                P.part_name,
                P.part_number,
                -- Created & Modified by names
                creators.username  AS created_by_name,
                updaters.username  AS modified_by_name
            FROM sub_group_parts SGP
            LEFT JOIN sub_groups SG ON SGP.sub_group_id = SG.sub_group_id
            LEFT JOIN parts      P  ON SGP.part_id      = P.part_id
            LEFT JOIN users creators ON SGP.created_by  = creators.user_uuid
            LEFT JOIN users updaters ON SGP.modified_by = updaters.user_uuid
            WHERE SGP.sub_group_parts_uuid = $1
              AND SGP.is_deleted           = FALSE
            `,
            [sub_group_parts_uuid]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Sub group part not found"
            });
        }

        const subGroupPart = result.rows[0];

        // -----------------------------
        // LOCK HANDLING (edit mode only)
        // -----------------------------
        let lockRow = null;

        if (mode === 'edit') {

            if (!user_id) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "User ID required for edit mode"
                });
            }

            const lockRes = await client.query(
                `SELECT RL.*, U.username AS locked_by_name
                 FROM record_locks RL
                 LEFT JOIN users U ON U.user_uuid = RL.locked_by
                 WHERE RL.table_name = 'sub_group_parts'
                   AND RL.record_id  = $1
                   AND RL.is_deleted = FALSE`,
                [sub_group_parts_uuid]
            );

            lockRow = lockRes.rows[0];

            const isExpired =
                lockRow &&
                new Date(lockRow.expires_at).getTime() < Date.now();

            if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2005,
                    message: `Record is locked by ${lockRow.locked_by_name}`
                });
            }

            if (lockRow && isExpired) {
                await client.query(
                    `UPDATE record_locks
                     SET is_deleted = TRUE,
                         deleted_by = $1,
                         deleted_at = NOW()
                     WHERE lock_id = $2`,
                    [user_id, lockRow.lock_id]
                );
                lockRow = null;
            }

            if (!lockRow) {
                const newLock = await client.query(
                    `INSERT INTO record_locks
                        (table_name, record_id, locked_by, expires_at, created_by)
                     VALUES
                        ('sub_group_parts', $1, $2, NOW() + ($3 || ' minute')::INTERVAL, $2)
                     RETURNING *`,
                    [sub_group_parts_uuid, user_id, LOCK_MINUTES]
                );
                lockRow = newLock.rows[0];
            } else if (lockRow.locked_by === user_id) {
                const refresh = await client.query(
                    `UPDATE record_locks
                     SET expires_at = NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id  = $1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );
                lockRow = refresh.rows[0];
            }
        }

        await client.query('COMMIT');

        subGroupPart.lock_status =
            lockRow &&
            new Date(lockRow.expires_at).getTime() >= Date.now();

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Sub group part fetched successfully",
            data: subGroupPart,
            lock: lockRow
                ? {
                    status    : subGroupPart.lock_status,
                    by        : lockRow.locked_by,
                    by_name   : lockRow.locked_by_name,
                    expires_at: lockRow.expires_at
                }
                : { status: false }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (getById-sub-group-part):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Fetch failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});


// ================================================================
// UPDATE SUB GROUP PART
// ================================================================


responder.on('update-sub-group-part', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { sub_group_parts_uuid } = req;
        const {
            sub_group_uuid,
            part_uuid,
            diagram_ref_no,
            qty,
            position_x,
            position_y,
            anchor_x,
            anchor_y,
            marker_type,
            is_clickable,
            notes,
            display_order,
            is_active,
            modified_by
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!sub_group_parts_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Sub Group Part UUID is required"
            });
        }

        if (!sub_group_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Sub Group UUID is required"
            });
        }

        if (!part_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Part UUID is required"
            });
        }

        if (!modified_by) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Modified by is required"
            });
        }

        // -----------------------------
        // FETCH sub_group_id FROM sub_group_uuid
        // -----------------------------
        const subGroupResult = await client.query(
            `SELECT sub_group_id FROM sub_groups
             WHERE sub_group_uuid = $1
               AND is_deleted = FALSE`,
            [sub_group_uuid]
        );

        if (subGroupResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid Sub Group UUID"
            });
        }

        const sub_group_id = subGroupResult.rows[0].sub_group_id;

        // -----------------------------
        // FETCH part_id FROM part_uuid
        // -----------------------------
        const partResult = await client.query(
            `SELECT part_id FROM parts
             WHERE part_uuid  = $1
               AND is_deleted = FALSE
               AND is_active  = TRUE`,
            [part_uuid]
        );

        if (partResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid Part UUID"
            });
        }

        const part_id = partResult.rows[0].part_id;

        // -----------------------------
        // CHECK EDIT LOCK
        // -----------------------------
        const lockCheck = await client.query(
            `SELECT 1 FROM record_locks
             WHERE table_name = 'sub_group_parts'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE
               AND expires_at > NOW()`,
            [sub_group_parts_uuid, modified_by]
        );

        if (lockCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2005,
                message: "Update failed",
                error: "You must lock the record before updating"
            });
        }

        // -----------------------------
        // CHECK RECORD EXISTS
        // -----------------------------
        const exists = await client.query(
            `SELECT id FROM sub_group_parts
             WHERE sub_group_parts_uuid = $1
               AND is_deleted           = FALSE`,
            [sub_group_parts_uuid]
        );

        if (exists.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Sub group part not found"
            });
        }

        // -----------------------------
        // DUPLICATE CHECK (same sub_group + part, excluding self)
        // -----------------------------
        const duplicateCheck = await client.query(
            `SELECT 1 FROM sub_group_parts
             WHERE sub_group_id          = $1
               AND part_id               = $2
               AND is_deleted            = FALSE
               AND sub_group_parts_uuid != $3`,
            [sub_group_id, part_id, sub_group_parts_uuid]
        );

        if (duplicateCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Update failed",
                error: "This part is already mapped"
            });
        }

        // -----------------------------
        // UPDATE SUB GROUP PART
        // -----------------------------
        const update = await client.query(
            `UPDATE sub_group_parts
             SET
                sub_group_id   = $1,
                part_id        = $2,
                diagram_ref_no = $3,
                qty            = $4,
                position_x     = $5,
                position_y     = $6,
                anchor_x       = $7,
                anchor_y       = $8,
                marker_type    = $9,
                is_clickable   = $10,
                notes          = $11,
                display_order  = $12,
                is_active      = $13,
                modified_by    = $14,
                modified_at    = NOW()
             WHERE sub_group_parts_uuid = $15
               AND is_deleted           = FALSE
             RETURNING *`,
            [
                sub_group_id,
                part_id,
                diagram_ref_no,
                qty,
                position_x,
                position_y,
                anchor_x,
                anchor_y,
                marker_type,
                is_clickable,
                notes,
                display_order,
                is_active !== null && is_active !== undefined ? is_active : true,
                modified_by,
                sub_group_parts_uuid
            ]
        );

        // -----------------------------
        // AUTO-UNLOCK AFTER SUCCESS
        // -----------------------------
        await client.query(
            `UPDATE record_locks
             SET is_deleted = TRUE,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE table_name = 'sub_group_parts'
               AND record_id  = $2
               AND locked_by  = $3
               AND is_deleted = FALSE`,
            [modified_by, sub_group_parts_uuid, modified_by]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Sub group part updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (update-sub-group-part):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Update failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// ================================================================
// DELETE SUB GROUP PART (SOFT DELETE)
// ================================================================

responder.on('delete-sub-group-part', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { sub_group_parts_uuid } = req;
        const { deleted_by }           = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!sub_group_parts_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Sub Group Part UUID is required"
            });
        }

        if (!deleted_by) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Deleted by is required"
            });
        }

        // -----------------------------
        // CHECK RECORD EXISTS
        // -----------------------------
        const check = await client.query(
            `SELECT id FROM sub_group_parts
             WHERE sub_group_parts_uuid = $1
               AND is_deleted           = FALSE`,
            [sub_group_parts_uuid]
        );

        if (check.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Sub group part not found"
            });
        }

        // -----------------------------
        // SOFT DELETE
        // -----------------------------
        await client.query(
            `UPDATE sub_group_parts
             SET
                is_deleted = TRUE,
                deleted_by = $1,
                deleted_at = NOW()
             WHERE sub_group_parts_uuid = $2`,
            [deleted_by, sub_group_parts_uuid]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Sub group part deleted successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (delete-sub-group-part):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Delete failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});


// ================================================================
// UNLOCK SUB GROUP PART RECORD
// ================================================================

responder.on('unlock-sub-group-part', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { sub_group_parts_uuid } = req;
        const { user_id }              = req.body;

        if (!user_id) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "User ID is required"
            });
        }

        await client.query('BEGIN');

        const result = await client.query(
            `DELETE FROM record_locks
             WHERE table_name = 'sub_group_parts'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE`,
            [sub_group_parts_uuid, user_id]
        );

        if (!result.rowCount) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Unable to unlock record",
                error: "Record is locked by another user or already unlocked"
            });
        }

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Sub group part record unlocked successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (unlock-sub-group-part):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Unlock failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});


// ================================================================
// ADVANCED FILTER — SUB GROUP PARTS
// ================================================================

responder.on('advancefilter-sub-group-parts', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        let extraWhere  = '';
        let extraParams = [];

        if (accessScope && accessScope.type === 'PRIVATE') {
            extraWhere = ' AND SGP.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table      : 'sub_group_parts',
            alias      : 'SGP',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN sub_groups SG        ON SGP.sub_group_id  = SG.sub_group_id
                LEFT JOIN parts      P          ON SGP.part_id       = P.part_id
                LEFT JOIN users      creators   ON SGP.created_by    = creators.user_uuid
                LEFT JOIN users      updaters   ON SGP.modified_by   = updaters.user_uuid
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'code',
                'sub_group_name',
                'part_name',
                'part_number',
                'diagram_ref_no',
                'qty',
                'marker_type',
                'is_clickable',
                'display_order',
                'created_at',
                'modified_at',
                'createdByName',
                'updatedByName'
            ],

            /* ---------------- Custom Joined Fields ---------------- */
            customFields: {
                sub_group_name: {
                    select: 'SG.name',
                    search: 'SG.name',
                    sort  : 'SG.name'
                },
                part_name: {
                    select: 'P.part_name',
                    search: 'P.part_name',
                    sort  : 'P.part_name'
                },
                part_number: {
                    select: 'P.part_number',
                    search: 'P.part_number',
                    sort  : 'P.part_number'
                },
                createdByName: {
                    select: 'creators.username',
                    search: 'creators.username',
                    sort  : 'creators.username'
                },
                updatedByName: {
                    select: 'updaters.username',
                    search: 'updaters.username',
                    sort  : 'updaters.username'
                }
            },

            /* ---------------- Base Where ---------------- */
            baseWhere : `SGP.is_deleted = FALSE ${extraWhere}`,
            baseParams: extraParams
        });

        return cb(null, {
            status: true,
            code  : 1000,
            result
        });

    } catch (err) {
        console.error('[advancefilter-sub-group-parts] error:', err);
        return cb(null, {
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : err.message,
            error             : err.message
        });
    }
});


// ================================================================
// STATUS TOGGLE — SUB GROUP PARTS (ACTIVE / INACTIVE)
// ================================================================

responder.on('status-sub-group-parts', async (req, cb) => {
    try {
        const { sub_group_parts_uuid } = req;
        const { modified_by } = req.body;

        if (!sub_group_parts_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Sub Group Part UUID is required"
            });
        }

        // FETCH CURRENT STATUS
        const check = await pool.query(
            `SELECT id, is_active
             FROM sub_group_parts
             WHERE sub_group_parts_uuid = $1
               AND is_deleted = FALSE`,
            [sub_group_parts_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Sub Group Part not found"
            });
        }

        const newStatus = !check.rows[0].is_active;

        // TOGGLE STATUS
        await pool.query(
            `UPDATE sub_group_parts
             SET
                is_active   = $1,
                modified_by = $2,
                modified_at = NOW()
             WHERE sub_group_parts_uuid = $3`,
            [newStatus, modified_by, sub_group_parts_uuid]
        );

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: newStatus
                ? "Sub Group Part activated successfully"
                : "Sub Group Part deactivated successfully"
        });

    } catch (err) {
        logger.error("Responder Error (status-sub-group-parts):", err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Status update failed",
            error: err.message
        });
    }
});

