require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');


// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'group responder',
    key: 'group',
    redis: { host: redisHost, port: redisPort }
});



// ================================================================
// Generate next group code
// ================================================================

async function generateNextGroupCode(pool) {
    // --------------------------------------------------
    // FETCH PREFIX
    // --------------------------------------------------
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM prefix_refno
         WHERE table_name = 'groups'
         AND is_active  = true
         AND is_deleted = false
         ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = prefixRes.rows[0]?.prefix_code || "GRP";

    // --------------------------------------------------
    // FETCH LAST GROUP CODE
    // --------------------------------------------------
    const result = await pool.query(
        `SELECT code FROM groups
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
// CREATE GROUP
// ================================================================

responder.on("create-group", async (req, cb) => {
    try {
        const {
            car_uuid,
            name,
            description,
            display_order,
            created_by,
            image_path
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!car_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Car UUID is required"
            });
        }

        if (!name?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Group name is required"
            });
        }

        // -----------------------------
        // FETCH car_id FROM car_uuid
        // -----------------------------
        const carQuery = {
            text: `
                SELECT car_id FROM cars
                WHERE car_uuid  = $1
                AND is_deleted = FALSE
                AND is_active  = TRUE
            `,
            values: [car_uuid]
        };

        const carResult = await pool.query(carQuery);

        if (carResult.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid Car UUID"
            });
        }

        const car_id = carResult.rows[0].car_id;

        // -----------------------------
        // DUPLICATE CHECK
        // -----------------------------
        const duplicateQuery = {
            text: `
                SELECT group_id FROM groups
                WHERE LOWER(name) = LOWER($1)
                AND car_id     = $2
                AND is_deleted = FALSE
            `,
            values: [name.trim(), car_id]
        };

        const duplicateCheck = await pool.query(duplicateQuery);

        if (duplicateCheck.rowCount > 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Creation failed",
                error: "Group already exists with the same name under this car"
            });
        }

        // --------------------------------------------------
        // AUTO-GENERATE GROUP CODE
        // --------------------------------------------------
        const group_code = await generateNextGroupCode(pool);

        // -----------------------------
        // INSERT GROUP
        // -----------------------------
        const insertQuery = {
            text: `
                INSERT INTO groups
                    (
                        car_id,
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
                    group_id,
                    car_id,
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
                car_id,
                group_code,
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
            message: "Group created successfully",
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (create-group):", err);

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
// GET GROUP BY UUID (WITH EDIT LOCKING)
// ================================================================

responder.on('getById-group', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { group_uuid } = req;
        const mode    = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!group_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Group UUID is required"
            });
        }

        await client.query('BEGIN');

        // -----------------------------
        // FETCH GROUP BY UUID
        // -----------------------------
        const result = await client.query(
            `
            SELECT
                g.group_id,
                g.group_uuid,
                g.code,
                g.name,
                g.display_order,
                g.car_id,
                g.is_active,
                g.assigned_to,
                g.assigned_at,
                g.created_at,
                g.created_by,
                g.modified_at,
                g.modified_by,
                g.is_deleted,
                -- Car info
                c.car_uuid,
                c.car_name,
                -- Created & Modified by names
                creators.username   AS created_by_name,
                updaters.username   AS modified_by_name
            FROM groups g
            LEFT JOIN cars c
                ON g.car_id = c.car_id
            LEFT JOIN users creators
                ON g.created_by = creators.user_uuid
            LEFT JOIN users updaters
                ON g.modified_by = updaters.user_uuid
            WHERE
                g.group_uuid = $1
                AND g.is_deleted = FALSE
            `,
            [group_uuid]
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
                error: "Group not found"
            });
        }

        const group = result.rows[0];

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
                 WHERE RL.table_name = 'groups'
                   AND RL.record_id  = $1
                   AND RL.is_deleted = FALSE`,
                [group_uuid]
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
                        ('groups', $1, $2, NOW() + ($3 || ' minute')::INTERVAL, $2)
                     RETURNING *`,
                    [group_uuid, user_id, LOCK_MINUTES]
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
        group.lock_status =
            lockRow &&
            new Date(lockRow.expires_at).getTime() >= Date.now();

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Group fetched successfully",
            data: group,
            lock: lockRow
                ? {
                    status    : group.lock_status,
                    by        : lockRow.locked_by,
                    by_name   : lockRow.locked_by_name,
                    expires_at: lockRow.expires_at
                }
                : { status: false }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (getById-group):", err);
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
// UPDATE GROUP
// ================================================================

responder.on('update-group', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { group_uuid } = req;
        const {
            car_uuid,
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
        if (!group_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Group UUID is required"
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
                error: "Group name is required"
            });
        }

        if (!car_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Car UUID is required"
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
        // FETCH car_id FROM car_uuid
        // -----------------------------
        const carResult = await client.query(
            `SELECT car_id FROM cars
             WHERE car_uuid   = $1
               AND is_deleted = FALSE
               AND is_active  = TRUE`,
            [car_uuid]
        );
        if (carResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid Car UUID"
            });
        }
        const car_id = carResult.rows[0].car_id;

        // -----------------------------
        // CHECK EDIT LOCK
        // -----------------------------
        const lockCheck = await client.query(
            `SELECT 1 FROM record_locks
             WHERE table_name = 'groups'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE
               AND expires_at > NOW()`,
            [group_uuid, modified_by]
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
        // CHECK GROUP EXISTS
        // -----------------------------
        const exists = await client.query(
            `SELECT group_id, image_path, description FROM groups
             WHERE group_uuid  = $1
               AND is_deleted = FALSE`,
            [group_uuid]
        );
        if (exists.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Group not found"
            });
        }

        const existingImagePath  = exists.rows[0].image_path;
        

        // -----------------------------
        // DUPLICATE NAME CHECK
        // -----------------------------
        const duplicateName = await client.query(
            `SELECT 1 FROM groups
             WHERE car_id     = $1
               AND name       = $2
               AND is_deleted = FALSE
               AND group_uuid != $3`,
            [car_id, name.trim(), group_uuid]
        );
        if (duplicateName.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Update failed",
                error: "A group with this name already exists for the given car"
            });
        }

        // -----------------------------
        // UPDATE GROUP
        // -----------------------------
        const update = await client.query(
            `
            UPDATE groups
            SET
                car_id        = $1,
                name          = $2,
                display_order = $3,
                is_active     = $4,
                modified_by   = $5,
                modified_at   = NOW(),
                image_path    = $6,
                description   = $7
            WHERE group_uuid  = $8
            RETURNING *
            `,
            [
                car_id,
                name.trim(),
                display_order,
                is_active,
                modified_by,
                image_path    || existingImagePath,
                description   ,
                group_uuid
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
             WHERE table_name = 'groups'
               AND record_id  = $2
               AND locked_by  = $3
               AND is_deleted = FALSE`,
            [modified_by, group_uuid, modified_by]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Group updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (update-group):", err);
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
// DELETE GROUP (SOFT DELETE)
// — blocked if group has parameter mappings
// ================================================================

responder.on('delete-group', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { group_uuid } = req;
        const { deleted_by } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!group_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Group UUID is required"
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
        // CHECK GROUP EXISTS & GET group_id
        // -----------------------------
        const check = await client.query(
            `SELECT group_id FROM groups
             WHERE group_uuid  = $1
               AND is_deleted = FALSE`,
            [group_uuid]
        );
        if (check.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Group not found"
            });
        }

        const group_id = check.rows[0].group_id;

        // -----------------------------
        // BLOCK DELETE 
        // -----------------------------
        const mappingCheck = await client.query(
            `SELECT 1 FROM sub_groups
             WHERE group_id   = $1
               AND is_deleted = FALSE
             LIMIT 1`,
            [group_id]
        );
        if (mappingCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Delete failed",
                error: "Group cannot be deleted because it has sub group mappings. Remove the mappings first"
            });
        }

        // -----------------------------
        // SOFT DELETE GROUP
        // -----------------------------
        await client.query(
            `UPDATE groups
             SET
                is_deleted = TRUE,
                is_active  = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
             WHERE group_uuid = $2`,
            [deleted_by, group_uuid]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Group deleted successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (delete-group):", err);
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
// STATUS TOGGLE — GROUP (ACTIVE / INACTIVE)
// ================================================================

responder.on('status-group', async (req, cb) => {
    try {
        const { group_uuid }  = req;
        const { modified_by } = req.body;

        if (!group_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Group UUID is required"
            });
        }

        // -----------------------------
        // FETCH CURRENT STATUS
        // -----------------------------
        const check = await pool.query(
            `SELECT group_id, is_active FROM groups
             WHERE group_uuid  = $1
               AND is_deleted = FALSE`,
            [group_uuid]
        );
        if (check.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Group not found"
            });
        }

        const newStatus = !check.rows[0].is_active;

        // -----------------------------
        // TOGGLE STATUS
        // -----------------------------
        await pool.query(
            `UPDATE groups
             SET
                is_active   = $1,
                modified_by = $2,
                modified_at = NOW()
             WHERE group_uuid = $3`,
            [newStatus, modified_by, group_uuid]
        );

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: newStatus
                ? "Group activated successfully"
                : "Group deactivated successfully"
        });

    } catch (err) {
        logger.error("Responder Error (status-group):", err);
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
// UNLOCK GROUP RECORD
// ================================================================

responder.on('unlock-group', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { group_uuid } = req;
        const { user_id }    = req.body;

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
             WHERE table_name = 'groups'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE`,
            [group_uuid, user_id]
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
            message: "Group record unlocked successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (unlock-group):", err);
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
// ADVANCED FILTER — GROUPS
// ================================================================

responder.on('advancefilter-groups', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        let extraWhere  = '';
        let extraParams = [];

        // If PRIVATE → only show own created data
        if (accessScope && accessScope.type === 'PRIVATE') {
            extraWhere = ' AND G.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table      : 'groups',
            alias      : 'G',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN cars    C  ON G.car_id     = C.car_id
                LEFT JOIN users   creators ON G.created_by  = creators.user_uuid
                LEFT JOIN users   updaters ON G.modified_by = updaters.user_uuid
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'name',
                'code',
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
                G.is_deleted = FALSE ${extraWhere}
            `,
            baseParams: extraParams
        });

        return cb(null, {
            status: true,
            code  : 1000,
            result
        });

    } catch (err) {
        console.error('[advancefilter-groups] error:', err);
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

