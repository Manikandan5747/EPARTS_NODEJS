require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');


// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'parameters responder',
    key: 'parameters',
    redis: { host: redisHost, port: redisPort }
});

// ================================================================
// Generate next parameter code
// ================================================================

async function generateNextParameterCode(pool) {
    // --------------------------------------------------
    // FETCH PREFIX
    // --------------------------------------------------
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM prefix_refno
         WHERE table_name = 'parameters'
         AND is_active    = true
         AND is_deleted   = false
         ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = prefixRes.rows[0]?.prefix_code || "PRM";

    // --------------------------------------------------
    // FETCH LAST PARAMETER CODE
    // --------------------------------------------------
    const result = await pool.query(
        `SELECT code FROM parameters
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
// CREATE 
// ================================================================

responder.on('create-parameter', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { name, created_by, values = [] } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!name?.trim()) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "Parameter name is required"
            });
        }

        if (!created_by) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "created_by is required"
            });
        }

        if (!Array.isArray(values) || values.length === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "At least one parameter value is required"
            });
        }

        for (let i = 0; i < values.length; i++) {
            if (!values[i].value?.trim()) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type       : "ERROR",
                    message_visibility: true,
                    status            : false,
                    code              : 2001,
                    message           : "Validation failed",
                    error             : `Value at index ${i} is empty`
                });
            }
        }

        // -----------------------------
        // DUPLICATE NAME CHECK
        // -----------------------------
        const dupName = await client.query(
            `SELECT 1 FROM parameters WHERE name = $1 AND is_deleted = FALSE`,
            [name.trim()]
        );
        if (dupName.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2002,
                message           : "Creation failed",
                error             : "A parameter with the same name already exists"
            });
        }

        // -----------------------------
        // AUTO-GENERATE OR VALIDATE CODE
        // -----------------------------
        let parameter_code =  await generateNextParameterCode(pool);

        const dupCode = await client.query(
            `SELECT 1 FROM parameters WHERE code = $1 AND is_deleted = FALSE`,
            [parameter_code]
        );
        if (dupCode.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2002,
                message           : "Creation failed",
                error             : "A parameter with the same code already exists"
            });
        }

        // -----------------------------
        // INSERT PARAMETER (HEADER)
        // -----------------------------
        const insertParam = await client.query(
            `INSERT INTO parameters
                (code, name, assigned_to, assigned_at, created_by)
             VALUES ($1, $2, $3, NOW(), $4)
             RETURNING *`,
            [parameter_code, name.trim(), created_by, created_by]
        );
        const parameter = insertParam.rows[0];

        // -----------------------------
        // INSERT PARAMETER VALUES (DETAIL)
        // -----------------------------
        const insertedValues = [];
        for (const v of values) {
           

            const insertVal = await client.query(
                `INSERT INTO parameter_values
                    (parameter_id, value, assigned_to, assigned_at, created_by)
                 VALUES ($1, $2, $3, NOW(), $3)
                 RETURNING *`,
                [parameter.parameter_id, v.value.trim(), created_by]
            );
            insertedValues.push(insertVal.rows[0]);
        }

        await client.query('COMMIT');

        return cb(null, {
            header_type       : "SUCCESS",
            message_visibility: true,
            status            : true,
            code              : 1000,
            message           : "Parameter created successfully",
            data              : { ...parameter, values: insertedValues }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (create-parameter):", err);
        return cb(null, {
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Internal server error",
            error             : err.message
        });
    } finally {
        client.release();
    }
});


// ================================================================
// GET PARAMETER BY ID  
// ================================================================

responder.on('getById-parameter', async (req, cb) => {

    const client = await pool.connect();

    try {

        const { parameter_uuid } = req;
        const mode    = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!parameter_uuid) {

            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "Parameter UUID is required"
            });
        }

        await client.query('BEGIN');

        // -----------------------------
        // FETCH PARAMETER HEADER
        // -----------------------------
        const paramRes = await client.query(
            `SELECT
                P.*,
                creators.username AS created_by_name,
                updaters.username AS modified_by_name
             FROM parameters P
             LEFT JOIN users creators
                ON P.created_by = creators.user_uuid
             LEFT JOIN users updaters
                ON P.modified_by = updaters.user_uuid
             WHERE P.parameter_uuid = $1
               AND P.is_deleted = FALSE`,
            [parameter_uuid]
        );

        // -----------------------------
        // PARAMETER NOT FOUND
        // -----------------------------
        if (paramRes.rowCount === 0) {

            await client.query('ROLLBACK');

            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2003,
                message           : "Record not found",
                error             : "Parameter not found"
            });
        }

        const parameter = paramRes.rows[0];

        // -----------------------------
        // FETCH PARAMETER VALUES
        // -----------------------------
        const valuesRes = await client.query(
            `SELECT
                PV.*,
                creators.username AS created_by_name,
                updaters.username AS modified_by_name
             FROM parameter_values PV
             LEFT JOIN users creators
                ON PV.created_by = creators.user_uuid
             LEFT JOIN users updaters
                ON PV.modified_by = updaters.user_uuid
             WHERE PV.parameter_id = $1
               AND PV.is_deleted = FALSE
             ORDER BY PV.parameter_value_id ASC`,
            [parameter.parameter_id]
        );

        parameter.values = valuesRes.rows;

        // -----------------------------
        // LOCK HANDLING
        // -----------------------------
        let lockRow = null;

        if (mode === 'edit') {

            // -----------------------------
            // VALIDATE USER ID
            // -----------------------------
            if (!user_id) {

                await client.query('ROLLBACK');

                return cb(null, {
                    header_type       : "ERROR",
                    message_visibility: true,
                    status            : false,
                    code              : 2001,
                    message           : "Validation failed",
                    error             : "User ID required for edit mode"
                });
            }

            // -----------------------------
            // CHECK EXISTING LOCK
            // -----------------------------
            const lockRes = await client.query(
                `SELECT
                    RL.*,
                    U.username AS locked_by_name
                 FROM record_locks RL
                 LEFT JOIN users U
                    ON U.user_uuid = RL.locked_by
                 WHERE RL.table_name = 'parameters'
                   AND RL.record_id = $1
                   AND RL.is_deleted = FALSE`,
                [parameter_uuid]
            );

            lockRow = lockRes.rows[0];

            const isExpired =
                lockRow &&
                new Date(lockRow.expires_at).getTime() < Date.now();

            // -----------------------------
            // LOCKED BY ANOTHER USER
            // -----------------------------
            if (
                lockRow &&
                lockRow.locked_by !== user_id &&
                !isExpired
            ) {

                await client.query('ROLLBACK');

                return cb(null, {
                    header_type       : "ERROR",
                    message_visibility: true,
                    status            : false,
                    code              : 2005,
                    message           : `Record is locked by ${lockRow.locked_by_name}`
                });
            }

            // -----------------------------
            // REMOVE EXPIRED LOCK
            // -----------------------------
            if (lockRow && isExpired) {

                await client.query(
                    `UPDATE record_locks
                     SET
                        is_deleted = TRUE,
                        deleted_by = $1,
                        deleted_at = NOW()
                     WHERE lock_id = $2`,
                    [user_id, lockRow.lock_id]
                );

                lockRow = null;
            }

            // -----------------------------
            // CREATE NEW LOCK
            // -----------------------------
            if (!lockRow) {

                const newLock = await client.query(
                    `INSERT INTO record_locks
                        (
                            table_name,
                            record_id,
                            locked_by,
                            expires_at,
                            created_by
                        )
                     VALUES
                        (
                            'parameters',
                            $1,
                            $2,
                            NOW() + ($3 || ' minute')::INTERVAL,
                            $2
                        )
                     RETURNING *`,
                    [parameter_uuid, user_id, LOCK_MINUTES]
                );

                lockRow = newLock.rows[0];
            }

            // -----------------------------
            // REFRESH SAME USER LOCK
            // -----------------------------
            else if (lockRow.locked_by === user_id) {

                const refreshLock = await client.query(
                    `UPDATE record_locks
                     SET expires_at =
                        NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id = $1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );

                lockRow = refreshLock.rows[0];
            }
        }

        await client.query('COMMIT');

        // -----------------------------
        // LOCK STATUS
        // -----------------------------
        parameter.lock_status =
            lockRow &&
            new Date(lockRow.expires_at).getTime() >= Date.now();

        // -----------------------------
        // SUCCESS RESPONSE
        // -----------------------------
        return cb(null, {
            header_type       : "SUCCESS",
            message_visibility: true,
            status            : true,
            code              : 1000,
            message           : "Parameter fetched successfully",
            data              : parameter,
            lock              : lockRow
                ? {
                    status     : parameter.lock_status,
                    by         : lockRow.locked_by,
                    by_name    : lockRow.locked_by_name,
                    expires_at : lockRow.expires_at
                }
                : {
                    status : false
                }
        });

    } catch (err) {

        await client.query('ROLLBACK');

        logger.error(
            "Responder Error (getById-parameter):",
            err
        );

        return cb(null, {
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Fetch failed",
            error             : err.message
        });

    } finally {

        client.release();
    }
});



// ================================================================
// UPDATE 
// ================================================================


// responder.on('update-parameter', async (req, cb) => {

//     const client = await pool.connect();

//     try {
//         await client.query('BEGIN');

//         const { parameter_uuid } = req;
//         const { name, modified_by, values = [] } = req.body;

//         // -----------------------------
//         // VALIDATION
//         // -----------------------------
//         if (!parameter_uuid) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2001,
//                 message: "Validation failed",
//                 error: "Parameter UUID is required"
//             });
//         }

//         if (!name?.trim()) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2001,
//                 message: "Validation failed",
//                 error: "Parameter name is required"
//             });
//         }

//         if (!modified_by) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2001,
//                 message: "Validation failed",
//                 error: "modified by is required"
//             });
//         }

//         // -----------------------------
//         // FETCH PARAMETER (GET ID FOR INTERNAL USE ONLY)
//         // -----------------------------
//         const paramRes = await client.query(
//             `SELECT parameter_id
//              FROM parameters
//              WHERE parameter_uuid = $1
//                AND is_deleted = FALSE`,
//             [parameter_uuid]
//         );

//         if (paramRes.rowCount === 0) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2003,
//                 message: "Record not found",
//                 error: "Parameter not found"
//             });
//         }

//         const parameter_id = paramRes.rows[0].parameter_id;

//         // -----------------------------
//         // CHECK EDIT LOCK
//         // -----------------------------
//         const lockCheck = await client.query(
//             `SELECT 1 FROM record_locks
//              WHERE table_name = 'parameters'
//                AND record_id  = $1
//                AND locked_by  = $2
//                AND is_deleted = FALSE
//                AND expires_at > NOW()`,
//             [parameter_uuid, modified_by]
//         );

//         if (lockCheck.rowCount === 0) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2005,
//                 message: "Update failed",
//                 error: "You must lock the record before updating"
//             });
//         }

//         // -----------------------------
//         // DUPLICATE CHECK — PARAMETER NAME
//         // (exclude current record from check)
//         // -----------------------------
//         const dupNameCheck = await client.query(
//             `SELECT 1 FROM parameters
//              WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
//                AND parameter_uuid != $2
//                AND is_deleted = FALSE`,
//             [name.trim(), parameter_uuid]
//         );

//         if (dupNameCheck.rowCount > 0) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2002,
//                 message: "Duplicate entry",
//                 error: "A parameter with this name already exists"
//             });
//         }

//         // -----------------------------
//         // DUPLICATE CHECK — PARAMETER VALUES
//         // (within the incoming values array itself)
//         // -----------------------------
//         const incomingValues = values
//             .filter(v => v.value?.trim())
//             .map(v => v.value.trim().toLowerCase());

//         const hasDuplicateInPayload = incomingValues.length !== new Set(incomingValues).size;

//         if (hasDuplicateInPayload) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2002,
//                 message: "Duplicate entry",
//                 error: "Duplicate values found in the submitted list"
//             });
//         }

//         // -----------------------------
//         // UPDATE PARAMETER HEADER
//         // -----------------------------
//         const updateParam = await client.query(
//             `UPDATE parameters
//              SET name = $1,
//                  modified_by = $2,
//                  modified_at = NOW()
//              WHERE parameter_uuid = $3
//              RETURNING *`,
//             [name.trim(), modified_by, parameter_uuid]
//         );

//         // -----------------------------
//         // UPDATE / INSERT VALUES USING UUID ONLY
//         // -----------------------------
//         const updatedValues = [];

//         for (const v of values) {

//             if (!v.value?.trim()) continue;

//             // -----------------------------
//             // UPDATE EXISTING VALUE (UUID BASED)
//             // -----------------------------
//             if (v.parameter_value_uuid) {

//                 // DUPLICATE CHECK — value already exists for this parameter
//                 // (exclude the current value record from the check)
//                 const dupValueCheck = await client.query(
//                     `SELECT 1 FROM parameter_values
//                      WHERE parameter_id = $1
//                        AND LOWER(TRIM(value)) = LOWER(TRIM($2))
//                        AND parameter_value_uuid != $3
//                        AND is_deleted = FALSE`,
//                     [parameter_id, v.value.trim(), v.parameter_value_uuid]
//                 );

//                 if (dupValueCheck.rowCount > 0) {
//                     await client.query('ROLLBACK');
//                     return cb(null, {
//                         header_type: "ERROR",
//                         message_visibility: true,
//                         status: false,
//                         code: 2002,
//                         message: "Duplicate entry",
//                         error: `Value "${v.value.trim()}" already exists for this parameter`
//                     });
//                 }

//                 const upd = await client.query(
//                     `UPDATE parameter_values
//                      SET value = $1,
//                          modified_by = $2,
//                          modified_at = NOW()
//                      WHERE parameter_value_uuid = $3
//                        AND parameter_id = $4
//                        AND is_deleted = FALSE
//                      RETURNING *`,
//                     [
//                         v.value.trim(),
//                         modified_by,
//                         v.parameter_value_uuid,
//                         parameter_id
//                     ]
//                 );

//                 if (upd.rowCount > 0) {
//                     updatedValues.push(upd.rows[0]);
//                 }
//             }

//             // -----------------------------
//             // INSERT NEW VALUE (UUID FLOW)
//             // -----------------------------
//             else {

//                 // DUPLICATE CHECK — value already exists for this parameter
//                 const dupValueCheck = await client.query(
//                     `SELECT 1 FROM parameter_values
//                      WHERE parameter_id = $1
//                        AND LOWER(TRIM(value)) = LOWER(TRIM($2))
//                        AND is_deleted = FALSE`,
//                     [parameter_id, v.value.trim()]
//                 );

//                 if (dupValueCheck.rowCount > 0) {
//                     await client.query('ROLLBACK');
//                     return cb(null, {
//                         header_type: "ERROR",
//                         message_visibility: true,
//                         status: false,
//                         code: 2002,
//                         message: "Duplicate entry",
//                         error: `Value "${v.value.trim()}" already exists for this parameter`
//                     });
//                 }

//                 const ins = await client.query(
//                     `INSERT INTO parameter_values
//                         (parameter_id, value, assigned_to, assigned_at, created_by)
//                      VALUES ($1, $2, $3, NOW(), $3)
//                      RETURNING *`,
//                     [
//                         parameter_id,
//                         v.value.trim(),
//                         modified_by
//                     ]
//                 );

//                 updatedValues.push(ins.rows[0]);
//             }
//         }

//         // -----------------------------
//         // AUTO-UNLOCK
//         // -----------------------------
//         await client.query(
//             `UPDATE record_locks
//              SET is_deleted = TRUE,
//                  deleted_by = $1,
//                  deleted_at = NOW()
//              WHERE table_name = 'parameters'
//                AND record_id = $2
//                AND locked_by = $1
//                AND is_deleted = FALSE`,
//             [modified_by, parameter_uuid]
//         );

//         await client.query('COMMIT');

//         return cb(null, {
//             header_type: "SUCCESS",
//             message_visibility: true,
//             status: true,
//             code: 1000,
//             message: "Parameter updated successfully",
//             data: {
//                 ...updateParam.rows[0],
//                 values: updatedValues
//             }
//         });

//     } catch (err) {

//         await client.query('ROLLBACK');

//         logger.error("Responder Error (update-parameter):", err);

//         return cb(null, {
//             header_type: "ERROR",
//             message_visibility: true,
//             status: false,
//             code: 2004,
//             message: "Update failed",
//             error: err.message
//         });

//     } finally {
//         client.release();
//     }
// });

responder.on('update-parameter', async (req, cb) => {

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { parameter_uuid } = req;
        const { name, modified_by, is_active, values = [] } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!parameter_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Parameter UUID is required"
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
                error: "Parameter name is required"
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
                error: "modified by is required"
      
            });
        }

        // -----------------------------
        // FETCH PARAMETER (GET ID FOR INTERNAL USE ONLY)
        // -----------------------------
        const paramRes = await client.query(
            `SELECT parameter_id
             FROM parameters
             WHERE parameter_uuid = $1
               AND is_deleted = FALSE`,
            [parameter_uuid]
        );

        if (paramRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Parameter not found"
            });
        }

        const parameter_id = paramRes.rows[0].parameter_id;

        // -----------------------------
        // CHECK EDIT LOCK
        // -----------------------------
        const lockCheck = await client.query(
            `SELECT 1 FROM record_locks
             WHERE table_name = 'parameters'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE
               AND expires_at > NOW()`,
            [parameter_uuid, modified_by]
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
        // DUPLICATE CHECK — PARAMETER NAME
        // (exclude current record from check)
        // -----------------------------
        const dupNameCheck = await client.query(
            `SELECT 1 FROM parameters
             WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
               AND parameter_uuid != $2
               AND is_deleted = FALSE`,
            [name.trim(), parameter_uuid]
        );

        if (dupNameCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Duplicate entry",
                error: "A parameter with this name already exists"
            });
        }

        // -----------------------------
        // DUPLICATE CHECK — PARAMETER VALUES
        // (within the incoming values array itself)
        // -----------------------------
        const incomingValues = values
            .filter(v => v.value?.trim())
            .map(v => v.value.trim().toLowerCase());

        const hasDuplicateInPayload = incomingValues.length !== new Set(incomingValues).size;

        if (hasDuplicateInPayload) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Duplicate entry",
                error: "Duplicate values found in the submitted list"
            });
        }

        // -----------------------------
        // UPDATE PARAMETER HEADER
        // is_active is updated only if explicitly passed in the request body
        // -----------------------------
        const updateParam = await client.query(
            `UPDATE parameters
             SET name        = $1,
                 modified_by = $2,
                 modified_at = NOW()
                 ${is_active !== undefined ? ', is_active = $4' : ''}
             WHERE parameter_uuid = $3
             RETURNING *`,
            is_active !== undefined
                ? [name.trim(), modified_by, parameter_uuid, is_active]
                : [name.trim(), modified_by, parameter_uuid]
        );

        // -----------------------------
        // UPDATE / INSERT VALUES USING UUID ONLY
        // -----------------------------
        const updatedValues = [];

        for (const v of values) {

            if (!v.value?.trim()) continue;

            // validate is_active per value if provided
            if (v.is_active !== undefined && typeof v.is_active !== 'boolean') {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: `is_active must be a boolean for value "${v.value.trim()}"`
                });
            }

            // -----------------------------
            // UPDATE EXISTING VALUE (UUID BASED)
            // -----------------------------
            if (v.parameter_value_uuid) {

                // DUPLICATE CHECK — value already exists for this parameter
                // (exclude the current value record from the check)
                const dupValueCheck = await client.query(
                    `SELECT 1 FROM parameter_values
                     WHERE parameter_id = $1
                       AND LOWER(TRIM(value)) = LOWER(TRIM($2))
                       AND parameter_value_uuid != $3
                       AND is_deleted = FALSE`,
                    [parameter_id, v.value.trim(), v.parameter_value_uuid]
                );

                if (dupValueCheck.rowCount > 0) {
                    await client.query('ROLLBACK');
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2002,
                        message: "Duplicate entry",
                        error: `Value "${v.value.trim()}" already exists for this parameter`
                    });
                }

                const upd = await client.query(
                    `UPDATE parameter_values
                     SET value       = $1,
                         modified_by = $2,
                         modified_at = NOW()
                         ${v.is_active !== undefined ? ', is_active = $5' : ''}
                     WHERE parameter_value_uuid = $3
                       AND parameter_id         = $4
                       AND is_deleted           = FALSE
                     RETURNING *`,
                    v.is_active !== undefined
                        ? [v.value.trim(), modified_by, v.parameter_value_uuid, parameter_id, v.is_active]
                        : [v.value.trim(), modified_by, v.parameter_value_uuid, parameter_id]
                );

                if (upd.rowCount > 0) {
                    updatedValues.push(upd.rows[0]);
                }
            }

            // -----------------------------
            // INSERT NEW VALUE (UUID FLOW)
            // -----------------------------
            else {

                // DUPLICATE CHECK — value already exists for this parameter
                const dupValueCheck = await client.query(
                    `SELECT 1 FROM parameter_values
                     WHERE parameter_id = $1
                       AND LOWER(TRIM(value)) = LOWER(TRIM($2))
                       AND is_deleted = FALSE`,
                    [parameter_id, v.value.trim()]
                );

                if (dupValueCheck.rowCount > 0) {
                    await client.query('ROLLBACK');
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2002,
                        message: "Duplicate entry",
                        error: `Value "${v.value.trim()}" already exists for this parameter`
                    });
                }

                const ins = await client.query(
                    `INSERT INTO parameter_values
                        (parameter_id, value, is_active, assigned_to, assigned_at, created_by)
                     VALUES ($1, $2, $3, $4, NOW(), $4)
                     RETURNING *`,
                    [
                        parameter_id,
                        v.value.trim(),
                        v.is_active !== undefined ? v.is_active : true,  
                        modified_by
                    ]
                );

                updatedValues.push(ins.rows[0]);
            }
        }

        // -----------------------------
        // AUTO-UNLOCK
        // -----------------------------
        await client.query(
            `UPDATE record_locks
             SET is_deleted = TRUE,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE table_name = 'parameters'
               AND record_id = $2
               AND locked_by = $1
               AND is_deleted = FALSE`,
            [modified_by, parameter_uuid]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Parameter updated successfully",
            data: {
                ...updateParam.rows[0],
                values: updatedValues
            }
        });

    } catch (err) {

        await client.query('ROLLBACK');

        logger.error("Responder Error (update-parameter):", err);

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
// DELETE   
// ================================================================

responder.on('delete-parameter', async (req, cb) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { parameter_uuid } = req;
        const { deleted_by } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!parameter_uuid || !deleted_by) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : !parameter_uuid
                    ? "Parameter UUID is required"
                    : "deleted_by is required"
            });
        }

        // -----------------------------
        // CHECK EXISTS
        // -----------------------------
        const check = await client.query(
            `SELECT parameter_id
             FROM parameters
             WHERE parameter_uuid = $1
               AND is_deleted = FALSE`,
            [parameter_uuid]
        );

        if (check.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2003,
                message           : "Record not found",
                error             : "Parameter not found or already deleted"  
            });
        }

        const parameter_id = check.rows[0].parameter_id;

        // -----------------------------
        // SOFT DELETE CHILD VALUES FIRST
        // -----------------------------
        await client.query(
            `UPDATE parameter_values
             SET is_deleted = TRUE,
                 is_active  = FALSE,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE parameter_id = $2
               AND is_deleted   = FALSE`,  
            [deleted_by, parameter_id]
        );

        // -----------------------------
        // SOFT DELETE PARENT HEADER
        // -----------------------------
        await client.query(
            `UPDATE parameters
             SET is_deleted = TRUE,
                 is_active  = FALSE,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE parameter_uuid = $2
               AND is_deleted     = FALSE`,  
            [deleted_by, parameter_uuid]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type       : "SUCCESS",
            message_visibility: true,
            status            : true,
            code              : 1000,
            message           : "Parameter deleted successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (delete-parameter):", err);
        return cb(null, {
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Delete failed",
            error             : err.message
        });
    } finally {
        client.release();
    }
});


// ================================================================
// STATUS TOGGLE — PARAMETER
// ================================================================

responder.on('status-parameter', async (req, cb) => {
    try {
        const { parameter_uuid } = req;
        const { modified_by }  = req.body;

        if (!parameter_uuid) {  
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "Parameter UUID is required"
            });
        }

        const check = await pool.query(
            `SELECT is_active FROM parameters
             WHERE parameter_uuid = $1 AND is_deleted = FALSE`,
            [parameter_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2003,
                message           : "Record not found",
                error             : "Parameter not found"
            });
        }

        const newStatus = !check.rows[0].is_active;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Toggle status in parameters table
            await client.query(
                `UPDATE parameters
                 SET is_active   = $1,
                     modified_by = $2,
                     modified_at = NOW()
                 WHERE parameter_uuid = $3`,
                [newStatus, modified_by, parameter_uuid]
            );

            // ✅ Toggle corresponding rows in parameter_values table
            await client.query(
                `UPDATE parameter_values pv
                 SET is_active   = $1,
                     modified_by = $2,
                     modified_at = NOW()
                 FROM parameters p
                 WHERE p.parameter_uuid = $3
                   AND pv.parameter_id  = p.parameter_id
                   AND pv.is_deleted    = FALSE`,
                [newStatus, modified_by, parameter_uuid]
            );

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        return cb(null, {
            header_type       : "SUCCESS",
            message_visibility: true,
            status            : true,
            code              : 1000,
            message           : newStatus
                ? "Parameter activated successfully"
                : "Parameter deactivated successfully"
        });

    } catch (err) {
        logger.error("Responder Error (status-parameter):", err);
        return cb(null, {
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Status update failed",
            error             : err.message
        });
    }
});

// ================================================================
// UNLOCK PARAMETER RECORD
// ================================================================

responder.on('unlock-parameter', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { parameter_uuid } = req;
        const { user_id }      = req.body;

        if (!user_id) {
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "User ID is required"
            });
        }

        await client.query('BEGIN');

        const result = await client.query(
            `DELETE FROM record_locks
             WHERE table_name = 'parameters'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE`,
            [parameter_uuid, user_id]
        );

        if (!result.rowCount) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2003,
                message           : "Unable to unlock record",
                error             : "Record is locked by another user or already unlocked"
            });
        }

        await client.query('COMMIT');

        return cb(null, {
            header_type       : "SUCCESS",
            message_visibility: true,
            status            : true,
            code              : 1000,
            message           : "Parameter record unlocked successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (unlock-parameter):", err);
        return cb(null, {
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Unlock failed",
            error             : err.message
        });
    } finally {
        client.release();
    }
});


// ================================================================
// ADVANCED FILTER — PARAMETERS
// ================================================================

// responder.on('advancefilter-parameters', async (req, cb) => {
//     try {
//         const accessScope = req.dataAccessScope;
//         let extraWhere  = '';
//         let extraParams = [];

//         if (accessScope && accessScope.type === 'PRIVATE') {
//             extraWhere = ' AND P.created_by = $extraUser';
//             extraParams.push(accessScope.user_id);
//         }

//         const result = await buildAdvancedSearchQuery({
//             pool,
//             reqBody   : req.body,
//             table      : 'parameters',
//             alias      : 'P',
//             defaultSort: 'created_at',

//             joinSql: `
//                 LEFT JOIN users creators ON P.created_by  = creators.user_uuid
//                 LEFT JOIN users updaters ON P.modified_by = updaters.user_uuid
//             `,

//             allowedFields: [
//                 'name',
//                 'code',
//                 'is_active',
//                 'created_at',
//                 'modified_at',
//                 'createdByName',
//                 'updatedByName'
//             ],

//             customFields: {
//                 createdByName: {
//                     select: 'creators.username',
//                     search: 'creators.username',
//                     sort  : 'creators.username'
//                 },
//                 updatedByName: {
//                     select: 'updaters.username',
//                     search: 'updaters.username',
//                     sort  : 'updaters.username'
//                 }
//             },

//             baseWhere : `P.is_deleted = FALSE ${extraWhere}`,
//             baseParams: extraParams
//         });

//         return cb(null, {
//             status: true,
//             code  : 1000,
//             result
//         });

//     } catch (err) {
//         logger.error('[advancefilter-parameters] error:', err);
//         return cb(null, {
//             header_type       : "ERROR",
//             message_visibility: true,
//             status            : false,
//             code              : 2004,
//             message           : err.message,
//             error             : err.message
//         });
//     }
// });


responder.on('advancefilter-parameters', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        let extraWhere  = '';
        let extraParams = [];
        if (accessScope && accessScope.type === 'PRIVATE') {
            extraWhere = ' AND P.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody   : req.body,
            table      : 'parameters',
            alias      : 'P',
            defaultSort: 'created_at',
            joinSql: `
                LEFT JOIN users creators ON P.created_by  = creators.user_uuid
                LEFT JOIN users updaters ON P.modified_by = updaters.user_uuid
            `,
            allowedFields: [
                'name',
                'code',
                'is_active',
                'created_at',
                'modified_at',
                'createdByName',
                'updatedByName',
                'parameterValues'
            ],
            customFields: {
                createdByName: {
                    select: 'creators.username',
                    search: 'creators.username',
                    sort  : 'creators.username'
                },
                updatedByName: {
                    select: 'updaters.username',
                    search: 'updaters.username',
                    sort  : 'updaters.username'
                },
                parameterValues: {
                    select: `(
                        SELECT STRING_AGG(
                            pv.value,
                            ', '
                            ORDER BY pv.parameter_value_id ASC
                        )
                        FROM parameter_values pv
                        WHERE pv.parameter_id = P.parameter_id
                          AND pv.is_deleted   = FALSE
                    )`,
                    search: `(
                        SELECT 1
                        FROM parameter_values pv
                        WHERE pv.parameter_id = P.parameter_id
                          AND pv.is_deleted   = FALSE
                          AND pv.value ILIKE $searchValue
                        LIMIT 1
                    )`,
                    sort: `(
                        SELECT STRING_AGG(pv.value, ', ' ORDER BY pv.parameter_value_id ASC)
                        FROM parameter_values pv
                        WHERE pv.parameter_id = P.parameter_id
                          AND pv.is_deleted   = FALSE
                    )`
                }
            },
            baseWhere : `P.is_deleted = FALSE ${extraWhere}`,
            baseParams: extraParams
        });
        return cb(null, {
            status: true,
            code  : 1000,
            result
        });
    } catch (err) {
        logger.error('[advancefilter-parameters] error:', err);
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

