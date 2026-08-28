require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');


// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'subnode responder',
    key: 'subnode',
    redis: { host: redisHost, port: redisPort }
});




// ================================================================
// Generate next sub node code
// ================================================================

async function generateNextSubNodeCode(pool) {
    // --------------------------------------------------
    // FETCH PREFIX
    // --------------------------------------------------
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM prefix_refno
         WHERE table_name = 'sub_nodes'
         AND is_active  = true
         AND is_deleted = false
         ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = prefixRes.rows[0]?.prefix_code || "SND";

    // --------------------------------------------------
    // FETCH LAST SUB NODE CODE
    // --------------------------------------------------
    const result = await pool.query(
        `SELECT code FROM sub_nodes
         WHERE code IS NOT NULL
         AND is_deleted = FALSE
         ORDER BY (regexp_replace(code, '\\D', '', 'g'))::int DESC
         LIMIT 1`
    );

    const lastCode = result.rows[0]?.code || null;
    if (!lastCode) return `${prefix}00001`;

    const match  = lastCode.match(/\d+$/);
    const number = match ? parseInt(match[0], 10) : 0;
    return `${prefix}${(number + 1).toString().padStart(5, "0")}`;
}


// ================================================================
// CREATE SUB NODE
// ================================================================

responder.on("create-sub-node", async (req, cb) => {
    try {
        const {
            sub_group_uuid,
            name,
            description,
            display_order,
            created_by,
            image_path
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
                error: "Sub group UUID is required"
            });
        }

        if (!name?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Sub node name is required"
            });
        }

        // -----------------------------
        // FETCH sub_group_id FROM sub_group_uuid
        // -----------------------------
        const subGroupQuery = {
            text: `
                SELECT sub_group_id FROM sub_groups
                WHERE sub_group_uuid = $1
                AND is_deleted      = FALSE
                AND is_active       = TRUE
            `,
            values: [sub_group_uuid]
        };

        const subGroupResult = await pool.query(subGroupQuery);

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
        // DUPLICATE CHECK
        // -----------------------------
        const duplicateQuery = {
            text: `
                SELECT sub_node_id FROM sub_nodes
                WHERE LOWER(name)  = LOWER($1)
                AND sub_group_id = $2
                AND is_deleted   = FALSE
            `,
            values: [name.trim(), sub_group_id]
        };

        const duplicateCheck = await pool.query(duplicateQuery);

        if (duplicateCheck.rowCount > 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Creation failed",
                error: "Sub node already exists with the same name under this sub group"
            });
        }

        // --------------------------------------------------
        // AUTO-GENERATE SUB NODE CODE
        // --------------------------------------------------
        const sub_node_code = await generateNextSubNodeCode(pool);

        // -----------------------------
        // INSERT SUB NODE
        // -----------------------------
        const insertQuery = {
            text: `
                INSERT INTO sub_nodes
                    (
                        sub_group_id,
                        code,
                        name,
                        description,
                        display_order,
                        assigned_to,
                        assigned_at,
                        created_by,
                        image_path
                    )
                VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING
                    sub_node_id,
                    sub_group_id,
                    code,
                    name,
                    description,
                    display_order,
                    assigned_to,
                    assigned_at,
                    is_active,
                    created_at,
                    created_by,
                    image_path
            `,
            values: [
                sub_group_id,
                sub_node_code,
                name.trim(),
                description,
                display_order || null,
                created_by,
                new Date(),
                created_by,
                image_path
            ]
        };

        const insert = await pool.query(insertQuery);

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Sub node created successfully",
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (create-sub-node):", err);

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
// GET SUB NODE BY UUID (WITH EDIT LOCKING)
// ================================================================

responder.on('getById-sub-node', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { sub_node_uuid } = req;
        const mode    = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!sub_node_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Sub Node UUID is required"
            });
        }

        await client.query('BEGIN');

        // -----------------------------
        // FETCH SUB NODE BY UUID
        // -----------------------------
        const result = await client.query(
            `
            SELECT
                sn.sub_node_id,
                sn.sub_node_uuid,
                sn.code,
                sn.name,
                sn.display_order,
                sn.sub_group_id,
                sn.is_active,
                sn.assigned_to,
                sn.assigned_at,
                sn.created_at,
                sn.created_by,
                sn.modified_at,
                sn.modified_by,
                sn.is_deleted,
                -- Sub Group info
                sg.sub_group_uuid,
                sg.name         AS sub_group_name,
                -- Group info
                g.group_uuid,
                g.name          AS group_name,
                -- Car info
                c.car_uuid,
                c.car_name,
                -- Created & Modified by names
                creators.username   AS created_by_name,
                updaters.username   AS modified_by_name
            FROM sub_nodes sn
            LEFT JOIN sub_groups sg
                ON sn.sub_group_id = sg.sub_group_id
            LEFT JOIN groups g
                ON sg.group_id = g.group_id
            LEFT JOIN cars c
                ON g.car_id = c.car_id
            LEFT JOIN users creators
                ON sn.created_by = creators.user_uuid
            LEFT JOIN users updaters
                ON sn.modified_by = updaters.user_uuid
            WHERE
                sn.sub_node_uuid = $1
                AND sn.is_deleted = FALSE
            `,
            [sub_node_uuid]
        );

        // -----------------------------
        // RECORD NOT FOUND
        // -----------------------------
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Sub Node not found"
            });
        }

        const sub_node = result.rows[0];

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
                 WHERE RL.table_name = 'sub_nodes'
                   AND RL.record_id  = $1
                   AND RL.is_deleted = FALSE`,
                [sub_node_uuid]
            );

            lockRow = lockRes.rows[0];

            const isExpired =
                lockRow &&
                new Date(lockRow.expires_at).getTime() < Date.now();

            // Locked by another user
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

            // Expired → clear old lock
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

            // Create new lock
            if (!lockRow) {
                const newLock = await client.query(
                    `INSERT INTO record_locks
                        (table_name, record_id, locked_by, expires_at, created_by)
                     VALUES
                        ('sub_nodes', $1, $2, NOW() + ($3 || ' minute')::INTERVAL, $2)
                     RETURNING *`,
                    [sub_node_uuid, user_id, LOCK_MINUTES]
                );
                lockRow = newLock.rows[0];
            }
            // Refresh lock (same user)
            else if (lockRow.locked_by === user_id) {
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

        // -----------------------------
        // LOCK STATUS
        // -----------------------------
        sub_node.lock_status =
            lockRow &&
            new Date(lockRow.expires_at).getTime() >= Date.now();

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Sub Node fetched successfully",
            data: sub_node,
            lock: lockRow
                ? {
                    status    : sub_node.lock_status,
                    by        : lockRow.locked_by,
                    by_name   : lockRow.locked_by_name,
                    expires_at: lockRow.expires_at
                }
                : { status: false }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (getById-sub-node):", err);
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
// UPDATE SUB NODE
// ================================================================

responder.on('update-sub-node', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { sub_node_uuid } = req;
        const {
            sub_group_uuid,
            name,
            display_order,
            is_active,
            modified_by,
            image_path,
            description
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!sub_node_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Sub Node UUID is required"
            });
        }

        if (!name?.trim()) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Sub Node name is required"
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
               AND is_deleted     = FALSE
               AND is_active      = TRUE`,
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
        // CHECK EDIT LOCK
        // -----------------------------
        const lockCheck = await client.query(
            `SELECT 1 FROM record_locks
             WHERE table_name = 'sub_nodes'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE
               AND expires_at > NOW()`,
            [sub_node_uuid, modified_by]
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
        // CHECK SUB NODE EXISTS
        // -----------------------------
        const exists = await client.query(
            `SELECT sub_node_id, image_path FROM sub_nodes
             WHERE sub_node_uuid = $1
               AND is_deleted    = FALSE`,
            [sub_node_uuid]
        );
        if (exists.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Sub Node not found"
            });
        }

        const existingImagePath   = exists.rows[0].image_path;
       

        // -----------------------------
        // DUPLICATE NAME CHECK
        // -----------------------------
        const duplicateName = await client.query(
            `SELECT 1 FROM sub_nodes
             WHERE sub_group_id   = $1
               AND name           = $2
               AND is_deleted     = FALSE
               AND sub_node_uuid != $3`,
            [sub_group_id, name.trim(), sub_node_uuid]
        );
        if (duplicateName.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Update failed",
                error: "A sub node with this name already exists for the given sub group"
            });
        }

        // -----------------------------
        // UPDATE SUB NODE
        // -----------------------------
        const update = await client.query(
            `
            UPDATE sub_nodes
            SET
                sub_group_id  = $1,
                name          = $2,
                display_order = $3,
                is_active     = $4,
                modified_by   = $5,
                modified_at   = NOW(),
                image_path    = $6,
                description   = $7
            WHERE sub_node_uuid = $8
            RETURNING *
            `,
            [
                sub_group_id,
                name.trim(),
                display_order,
                is_active,
                modified_by,
                image_path  || existingImagePath,
                description ,
                sub_node_uuid
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
             WHERE table_name = 'sub_nodes'
               AND record_id  = $2
               AND locked_by  = $3
               AND is_deleted = FALSE`,
            [modified_by, sub_node_uuid, modified_by]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Sub Node updated successfully",
            data: update.rows[0]
        });

     } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (update-sub-node):", err);
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
// DELETE SUB NODE (SOFT DELETE)
// — blocked if sub node has mappings in parts
// ================================================================

responder.on('delete-sub-node', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { sub_node_uuid } = req;
        const { deleted_by }    = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!sub_node_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Sub Node UUID is required"
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
        // CHECK SUB NODE EXISTS & GET sub_node_id
        // -----------------------------
        const check = await client.query(
            `SELECT sub_node_id FROM sub_nodes
             WHERE sub_node_uuid = $1
               AND is_deleted    = FALSE`,
            [sub_node_uuid]
        );
        if (check.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Sub Node not found"
            });
        }

        const sub_node_id = check.rows[0].sub_node_id;

        // -----------------------------
        // BLOCK DELETE — parts
        // -----------------------------
        const partsCheck = await client.query(
            `SELECT 1 FROM parts
             WHERE sub_node_id = $1
               AND is_deleted  = FALSE
             LIMIT 1`,
            [sub_node_id]
        );
        if (partsCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Delete failed",
                error: "Sub Node cannot be deleted because it has part mappings. Remove the mappings first"
            });
        }

        // -----------------------------
        // SOFT DELETE SUB NODE
        // -----------------------------
        await client.query(
            `UPDATE sub_nodes
             SET
                is_deleted = TRUE,
                is_active  = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
             WHERE sub_node_uuid = $2`,
            [deleted_by, sub_node_uuid]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Sub Node deleted successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (delete-sub-node):", err);
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
// STATUS TOGGLE — SUB NODE (ACTIVE / INACTIVE)
// ================================================================

responder.on('status-sub-node', async (req, cb) => {
    try {
        const { sub_node_uuid } = req;
        const { modified_by }   = req.body;

        if (!sub_node_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Sub Node UUID is required"
            });
        }

        // -----------------------------
        // FETCH CURRENT STATUS
        // -----------------------------
        const check = await pool.query(
            `SELECT sub_node_id, is_active FROM sub_nodes
             WHERE sub_node_uuid = $1
               AND is_deleted    = FALSE`,
            [sub_node_uuid]
        );
        if (check.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Sub Node not found"
            });
        }

        const newStatus = !check.rows[0].is_active;

        // -----------------------------
        // TOGGLE STATUS
        // -----------------------------
        await pool.query(
            `UPDATE sub_nodes
             SET
                is_active   = $1,
                modified_by = $2,
                modified_at = NOW()
             WHERE sub_node_uuid = $3`,
            [newStatus, modified_by, sub_node_uuid]
        );

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: newStatus
                ? "Sub Node activated successfully"
                : "Sub Node deactivated successfully"
        });

    } catch (err) {
        logger.error("Responder Error (status-sub-node):", err);
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


// ================================================================
// UNLOCK SUB NODE RECORD
// ================================================================

responder.on('unlock-sub-node', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { sub_node_uuid } = req;
        const { user_id }       = req.body;

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
             WHERE table_name = 'sub_nodes'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE`,
            [sub_node_uuid, user_id]
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
            message: "Sub Node record unlocked successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (unlock-sub-node):", err);
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
// ADVANCED FILTER — SUB NODES
// ================================================================

responder.on('advancefilter-sub-nodes', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        let extraWhere  = '';
        let extraParams = [];

        // If PRIVATE → only show own created data
        if (accessScope && accessScope.type === 'PRIVATE') {
            extraWhere = ' AND SN.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table      : 'sub_nodes',
            alias      : 'SN',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN sub_groups SG ON SN.sub_group_id = SG.sub_group_id
                LEFT JOIN groups     G  ON SG.group_id     = G.group_id
                LEFT JOIN cars       C  ON G.car_id         = C.car_id
                LEFT JOIN users   creators ON SN.created_by  = creators.user_uuid
                LEFT JOIN users   updaters ON SN.modified_by = updaters.user_uuid
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'name',
                'code',
                'sub_group_name',
                'group_name',
                'car_name',
                'display_order',
                'is_active',
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
                group_name: {
                    select: 'G.name',
                    search: 'G.name',
                    sort  : 'G.name'
                },
                car_name: {
                    select: 'C.car_name',
                    search: 'C.car_name',
                    sort  : 'C.car_name'
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
            baseWhere: `
                SN.is_deleted = FALSE ${extraWhere}
            `,
            baseParams: extraParams
        });

        return cb(null, {
            status: true,
            code  : 1000,
            result
        });

    } catch (err) {
        console.error('[advancefilter-sub-nodes] error:', err);
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
