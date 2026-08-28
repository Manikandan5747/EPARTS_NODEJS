require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');
const commonenum = require('@libs/config/enum');
const multipart = require("connect-multiparty");
const fs = require("fs");
const path = require('path');
const uploadDir = path.join('/app/assets', 'parts');
const multipartMiddleware = multipart({ uploadDir });


// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'parts responder',
    key: 'parts',
    redis: { host: redisHost, port: redisPort }
});


responder.on('part-filesave', async (req, cb) => {
    const client = await pool.connect();

    try {
        const file = req.files?.file;

        /* ======================================================
           VALIDATION
        ====================================================== */
        if (!file) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "File is required"
            });
        }

        /* ======================================================
           MIME TYPE VALIDATION
        ====================================================== */
        const allowedMimeTypes = [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp"
        ];

        if (!allowedMimeTypes.includes(file.type)) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Invalid file type",
                error: "Only image files are allowed (jpeg, jpg, png, webp)"
            });
        }

        /* ======================================================
           FILE SIZE VALIDATION
        ====================================================== */
        const MAX_SIZE_MB = 10;
        const maxSize     = MAX_SIZE_MB * 1024 * 1024;

        if (file.size > maxSize) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `File size should not exceed ${MAX_SIZE_MB}MB`
            });
        }

        /* ======================================================
           FILE SAVE — keep original file name as-is
        ====================================================== */
        const originalFileName = file.name;
        const finalPath        = path.join(uploadDir, originalFileName).replace(/\\/g, '/');

        fs.renameSync(file.path, finalPath);

        /* ======================================================
           SUCCESS RESPONSE
        ====================================================== */
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "File uploaded successfully",
            data: {
                file_path    : finalPath,
                original_name: originalFileName
            }
        });

    } catch (err) {
        logger.error("Responder Error (part-filesave):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Internal server error",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// ================================================================
// Generate next car code
// ================================================================

async function generateNextCarCode(pool) {
    // --------------------------------------------------
    // FETCH PREFIX
    // --------------------------------------------------
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM prefix_refno
         WHERE table_name = 'cars' 
         AND is_active = true 
         AND is_deleted = false
         ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = prefixRes.rows[0]?.prefix_code || "CAR";

    // --------------------------------------------------
    // FETCH LAST CAR CODE
    // --------------------------------------------------
    const result = await pool.query(
        `SELECT code FROM cars
         WHERE code IS NOT NULL
         AND is_deleted = FALSE
         ORDER BY (regexp_replace(code, '\\D', '', 'g'))::int DESC
         LIMIT 1`
    );

    const lastCode = result.rows[0]?.code || null;
    if (!lastCode) return `${prefix}00001`;

    const match = lastCode.match(/\d+$/);
    const number = match ? parseInt(match[0], 10) : 0;
    return `${prefix}${(number + 1).toString().padStart(5, "0")}`;
}


// ================================================================
// CREATE CAR
// ================================================================


// ================================================================
// Helper — resolve parameter_value_uuids → ids
// ================================================================
async function resolveParameterValues(client, parameter_value_uuids) {
    if (!Array.isArray(parameter_value_uuids) || parameter_value_uuids.length === 0) {
        return { success: true, data: [] };
    }

    const res = await client.query(
        `SELECT pv.parameter_value_id,
                pv.parameter_value_uuid,
                pv.parameter_id
         FROM   parameter_values pv
         WHERE  pv.parameter_value_uuid = ANY($1::uuid[])
           AND  pv.is_deleted = FALSE
           AND  pv.is_active  = TRUE`,
        [parameter_value_uuids]
    );

    if (res.rowCount !== parameter_value_uuids.length) {
        const foundUuids = res.rows.map(r => r.parameter_value_uuid);
        const missing    = parameter_value_uuids.filter(u => !foundUuids.includes(u));
        return {
            success: false,
            error: `Invalid or inactive parameter_value_uuid(s): ${missing.join(", ")}`
        };
    }

    return { success: true, data: res.rows };
}


// ================================================================
// Helper — upsert car_parameter_mapping rows for a given car_id.
// - Soft-deletes mappings whose parameter_value_id is no longer
//   in the new list.
// - Inserts / restores the ones that are.
// ================================================================
async function syncParameterMappings(client, car_id, resolvedValues, actor_uuid) {
    if (!resolvedValues.length) {
        // Remove all existing mappings if payload sends empty array
        await client.query(
            `UPDATE car_parameter_mapping
             SET    is_deleted = TRUE,
                    deleted_by = $1,
                    deleted_at = NOW()
             WHERE  car_id     = $2
               AND  is_deleted = FALSE`,
            [actor_uuid, car_id]
        );
        return;
    }

    const incomingParameterValueIds = resolvedValues.map(r => r.parameter_value_id);

    // ✅ Soft-delete mappings NOT in the new set (keyed by parameter_value_id)
    await client.query(
        `UPDATE car_parameter_mapping
         SET    is_deleted = TRUE,
                deleted_by = $1,
                deleted_at = NOW()
         WHERE  car_id              = $2
           AND  parameter_value_id != ALL($3::bigint[])
           AND  is_deleted          = FALSE`,
        [actor_uuid, car_id, incomingParameterValueIds]
    );

    // ✅ Upsert each value independently by (car_id, parameter_value_id)
    for (const { parameter_id, parameter_value_id } of resolvedValues) {
        await client.query(
            `INSERT INTO car_parameter_mapping
                 (car_id, parameter_id, parameter_value_id,
                  assigned_to, assigned_at, created_by)
             VALUES
                 ($1, $2, $3, $4, NOW(), $4)
             ON CONFLICT (car_id, parameter_value_id)
             DO UPDATE SET
                 parameter_id = EXCLUDED.parameter_id,
                 is_deleted   = FALSE,
                 deleted_by   = NULL,
                 deleted_at   = NULL,
                 modified_by  = $4,
                 modified_at  = NOW()`,
            [car_id, parameter_id, parameter_value_id, actor_uuid]
        );
    }
}


// ================================================================
// CREATE CAR
// ================================================================
responder.on("create-car", async (req, cb) => {
    const client = await pool.connect();

    try {
        const {
            car_name,
            brand_uuid,
            model_uuid,
            erp_id,
            last_integrated_date,
            created_by,
            parameter_value_uuids   // array of parameter_value_uuid
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!car_name?.trim()) {
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "Car name is required"
            });
        }

        if (!brand_uuid) {
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "Brand UUID is required"
            });
        }

        if (!model_uuid) {
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "Model UUID is required"
            });
        }

        if (!created_by) {
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "created_by is required"
            });
        }

        await client.query('BEGIN');

        // -----------------------------
        // FETCH brand_id FROM brand_uuid
        // -----------------------------
        const brandResult = await client.query(
            `SELECT brand_id FROM brand
             WHERE brand_uuid = $1
               AND is_deleted = FALSE
               AND is_active  = TRUE`,
            [brand_uuid]
        );
        if (brandResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "Invalid Brand UUID"
            });
        }
        const brand_id = brandResult.rows[0].brand_id;

        // -----------------------------
        // FETCH model_id FROM model_uuid
        // AND ENSURE MODEL BELONGS TO BRAND
        // -----------------------------
        const modelResult = await client.query(
            `SELECT model_id FROM model
             WHERE model_uuid = $1
               AND brand_id   = $2
               AND is_deleted = FALSE
               AND is_active  = TRUE`,
            [model_uuid, brand_id]
        );
        if (modelResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "Invalid Model UUID or Model does not belong to the given Brand"
            });
        }
        const model_id = modelResult.rows[0].model_id;

        // -----------------------------
        // DUPLICATE CHECK
        // -----------------------------
        const duplicateCheck = await client.query(
            `SELECT car_id FROM cars
             WHERE car_name   = $1
               AND brand_id   = $2
               AND model_id   = $3
               AND is_deleted = FALSE`,
            [car_name.trim(), brand_id, model_id]
        );
        if (duplicateCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2002,
                message           : "Creation failed",
                error             : "Car already exists with the same name, brand and model"
            });
        }

        // --------------------------------------------------
        // RESOLVE PARAMETER VALUE UUIDs → IDs
        // --------------------------------------------------
        let resolvedValues = [];
        if (Array.isArray(parameter_value_uuids) && parameter_value_uuids.length > 0) {
            const resolved = await resolveParameterValues(client, parameter_value_uuids);
            if (!resolved.success) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type       : "ERROR",
                    message_visibility: true,
                    status            : false,
                    code              : 2001,
                    message           : "Validation failed",
                    error             : resolved.error
                });
            }
            resolvedValues = resolved.data;
        }

        // --------------------------------------------------
        // AUTO-GENERATE CAR CODE
        // --------------------------------------------------
        const car_code = await generateNextCarCode(client);

        // -----------------------------
        // INSERT CAR
        // -----------------------------
        const insert = await client.query(
            `INSERT INTO cars
                 (code, car_name, brand_id, model_id, erp_id,
                  last_integrated_date, assigned_to, assigned_at, created_by)
             VALUES
                 ($1, $2, $3, $4, $5, $6, $7, NOW(), $7)
             RETURNING
                 car_id, code, car_name, brand_id, model_id,
                 erp_id, last_integrated_date, assigned_to,
                 assigned_at, is_active, created_at, created_by`,
            [
                car_code,
                car_name.trim(),
                brand_id,
                model_id,
                erp_id               || null,
                last_integrated_date || null,
                created_by
            ]
        );

        const car = insert.rows[0];

        // --------------------------------------------------
        // INSERT / SYNC PARAMETER MAPPINGS
        // --------------------------------------------------
        await syncParameterMappings(client, car.car_id, resolvedValues, created_by);

        await client.query('COMMIT');

        // --------------------------------------------------
        // FETCH SAVED MAPPINGS TO RETURN IN RESPONSE
        // --------------------------------------------------
        const mappingsRes = await pool.query(
            `SELECT cpm.mapping_uuid,
                    pv.parameter_value_uuid,
                    pv.value             AS parameter_value,
                    p.parameter_uuid,
                    p.name               AS parameter_name
             FROM   car_parameter_mapping cpm
             JOIN   parameter_values pv ON pv.parameter_value_id = cpm.parameter_value_id
             JOIN   parameters       p  ON p.parameter_id        = cpm.parameter_id
             WHERE  cpm.car_id     = $1
               AND  cpm.is_deleted = FALSE`,
            [car.car_id]
        );

        return cb(null, {
            header_type       : "SUCCESS",
            message_visibility: true,
            status            : true,
            code              : 1000,
            message           : "Car created successfully",
            data              : {
                ...car,
                parameter_mappings: mappingsRes.rows
            }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (create-car):", err);
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
// GET CAR BY UUID (WITH EDIT LOCKING)
// ================================================================

responder.on('getById-car', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { car_uuid } = req;
        const mode     = req.body?.mode;
        const user_id  = req.body?.user_id;

        const LOCK_MINUTES = 1;

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

        await client.query('BEGIN');

        // -----------------------------
        // FETCH CAR BY UUID
        // -----------------------------
        const result = await client.query(
            `SELECT
                c.car_id,
                c.car_uuid,
                c.code,
                c.car_name,
                c.brand_id,
                c.model_id,
                c.erp_id,
                c.last_integrated_date,
                c.is_active,
                c.assigned_to,
                c.assigned_at,
                c.created_at,
                c.created_by,
                c.modified_at,
                c.modified_by,
                c.is_deleted,
                -- Brand info
                b.brand_uuid,
                b.name              AS brand_name,
                -- Model info
                m.model_uuid,
                m.name              AS model_name,
                -- Created & Modified by names
                creators.username   AS created_by_name,
                updaters.username   AS modified_by_name
             FROM  cars c
             LEFT JOIN brand  b        ON c.brand_id   = b.brand_id
             LEFT JOIN model  m        ON c.model_id   = m.model_id
             LEFT JOIN users  creators ON c.created_by = creators.user_uuid
             LEFT JOIN users  updaters ON c.modified_by= updaters.user_uuid
             WHERE c.car_uuid   = $1
               AND c.is_deleted = FALSE`,
            [car_uuid]
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
                error: "Car not found"
            });
        }

        const car = result.rows[0];

        // --------------------------------------------------
        // FETCH PARAMETER MAPPINGS
        // --------------------------------------------------
        const mappingsRes = await client.query(
            `SELECT cpm.mapping_uuid,
                    pv.parameter_value_uuid,
                    pv.value             AS parameter_value,
                    p.parameter_uuid,
                    p.name               AS parameter_name
             FROM   car_parameter_mapping cpm
             JOIN   parameter_values pv ON pv.parameter_value_id = cpm.parameter_value_id
             JOIN   parameters       p  ON p.parameter_id        = cpm.parameter_id
             WHERE  cpm.car_id     = $1
               AND  cpm.is_deleted = FALSE`,
            [car.car_id]
        );
        car.parameter_mappings = mappingsRes.rows;

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
                 WHERE RL.table_name = 'cars'
                   AND RL.record_id  = $1
                   AND RL.is_deleted = FALSE`,
                [car_uuid]
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
                         ('cars', $1, $2, NOW() + ($3 || ' minute')::INTERVAL, $2)
                     RETURNING *`,
                    [car_uuid, user_id, LOCK_MINUTES]
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
        car.lock_status =
            lockRow &&
            new Date(lockRow.expires_at).getTime() >= Date.now();

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Car fetched successfully",
            data: car,
            lock: lockRow
                ? {
                    status    : car.lock_status,
                    by        : lockRow.locked_by,
                    by_name   : lockRow.locked_by_name,
                    expires_at: lockRow.expires_at
                }
                : { status: false }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (getById-car):", err);
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
// UPDATE CAR
// ================================================================


responder.on('update-car', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { car_uuid } = req;
        const {
            car_name,
            brand_uuid,
            model_uuid,
            erp_id,
            last_integrated_date,
            is_active,
            modified_by,
            parameter_value_uuids   // array of parameter_value_uuid
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
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

        if (!car_name?.trim()) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Car name is required"
            });
        }

        if (!brand_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Brand UUID is required"
            });
        }

        if (!model_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Model UUID is required"
            });
        }

        // -----------------------------
        // FETCH brand_id FROM brand_uuid
        // -----------------------------
        const brandResult = await client.query(
            `SELECT brand_id FROM brand
             WHERE brand_uuid = $1
               AND is_deleted = FALSE
               AND is_active  = TRUE`,
            [brand_uuid]
        );
        if (brandResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid Brand UUID"
            });
        }
        const brand_id = brandResult.rows[0].brand_id;

        // -----------------------------
        // FETCH model_id FROM model_uuid
        // AND ENSURE MODEL BELONGS TO BRAND
        // -----------------------------
        const modelResult = await client.query(
            `SELECT model_id FROM model
             WHERE model_uuid = $1
               AND brand_id   = $2
               AND is_deleted = FALSE
               AND is_active  = TRUE`,
            [model_uuid, brand_id]
        );
        if (modelResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid Model UUID or Model does not belong to the given Brand"
            });
        }
        const model_id = modelResult.rows[0].model_id;

        // -----------------------------
        // CHECK EDIT LOCK
        // -----------------------------
        const lockCheck = await client.query(
            `SELECT 1 FROM record_locks
             WHERE table_name = 'cars'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE
               AND expires_at > NOW()`,
            [car_uuid, modified_by]
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
        // CHECK CAR EXISTS
        // -----------------------------
        const exists = await client.query(
            `SELECT car_id FROM cars
             WHERE car_uuid   = $1
               AND is_deleted = FALSE`,
            [car_uuid]
        );
        if (exists.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Car not found"
            });
        }
        const car_id = exists.rows[0].car_id;

        // -----------------------------
        // DUPLICATE CHECK
        // (same car_name + brand + model, excluding current record)
        // -----------------------------
        const duplicate = await client.query(
            `SELECT car_id FROM cars
             WHERE car_name   = $1
               AND brand_id   = $2
               AND model_id   = $3
               AND is_deleted = FALSE
               AND car_uuid  != $4`,
            [car_name.trim(), brand_id, model_id, car_uuid]
        );
        if (duplicate.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Update failed",
                error: "Car already exists with the same name, brand and model"
            });
        }

        // --------------------------------------------------
        // RESOLVE PARAMETER VALUE UUIDs → IDs
        // --------------------------------------------------
        let resolvedValues = [];
        if (Array.isArray(parameter_value_uuids)) {
            if (parameter_value_uuids.length > 0) {
                const resolved = await resolveParameterValues(client, parameter_value_uuids);
                if (!resolved.success) {
                    await client.query('ROLLBACK');
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: resolved.error
                    });
                }
                resolvedValues = resolved.data;
            }
            // Sync mappings (handles both empty and populated arrays)
            await syncParameterMappings(client, car_id, resolvedValues, modified_by);
        }
        // If parameter_value_uuids is not in payload at all → leave mappings untouched

        // -----------------------------
        // UPDATE CAR
        // -----------------------------
        const update = await client.query(
            `UPDATE cars
             SET
                 car_name             = $1,
                 brand_id             = $2,
                 model_id             = $3,
                 erp_id               = $4,
                 last_integrated_date = $5,
                 is_active            = $6,
                 modified_by          = $7,
                 modified_at          = NOW()
             WHERE car_uuid   = $8
             RETURNING *`,
            [
                car_name.trim(),
                brand_id,
                model_id,
                erp_id               || null,
                last_integrated_date || null,
                is_active,
                modified_by,
                car_uuid
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
             WHERE table_name = 'cars'
               AND record_id  = $2
               AND locked_by  = $3
               AND is_deleted = FALSE`,
            [modified_by, car_uuid, modified_by]
        );

        await client.query('COMMIT');

        // Fetch updated mappings to return in response
        const mappingsRes = await pool.query(
            `SELECT cpm.mapping_uuid,
                    pv.parameter_value_uuid,
                    pv.value             AS parameter_value,
                    p.parameter_uuid,
                    p.name               AS parameter_name
             FROM   car_parameter_mapping cpm
             JOIN   parameter_values pv ON pv.parameter_value_id = cpm.parameter_value_id
             JOIN   parameters       p  ON p.parameter_id        = cpm.parameter_id
             WHERE  cpm.car_id     = $1
               AND  cpm.is_deleted = FALSE`,
            [car_id]
        );

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Car updated successfully",
            data: {
                ...update.rows[0],
                parameter_mappings: mappingsRes.rows
            }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (update-car):", err);
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
// DELETE CAR (SOFT DELETE)
// — blocked if car is mapped in  groups
// ================================================================

responder.on('delete-car', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { car_uuid }   = req;
        const { deleted_by } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!car_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "Car UUID is required"
            });
        }

        if (!deleted_by) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "Deleted by is required"
            });
        }

        // -----------------------------
        // CHECK CAR EXISTS & GET car_id
        // -----------------------------
        const check = await client.query(
            `SELECT car_id FROM cars
             WHERE  car_uuid   = $1
               AND  is_deleted = FALSE`,
            [car_uuid]
        );
        if (check.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2003,
                message           : "Record not found",
                error             : "Car not found or already deleted"
            });
        }

        const car_id = check.rows[0].car_id;

        // -----------------------------
        // BLOCK DELETE — groups
        // -----------------------------
        const groupCheck = await client.query(
            `SELECT 1 FROM groups
             WHERE  car_id     = $1
               AND  is_deleted = FALSE
             LIMIT 1`,
            [car_id]
        );
        if (groupCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2003,
                message           : "Delete failed",
                error             : "Car cannot be deleted because it has groups assigned. Remove the groups first"
            });
        }

        // -----------------------------
        // SOFT DELETE car_parameter_mapping
        // -----------------------------
        await client.query(
            `UPDATE car_parameter_mapping
             SET    is_deleted = TRUE,
                    is_active  = FALSE,
                    deleted_by = $1,
                    deleted_at = NOW()
             WHERE  car_id     = $2
               AND  is_deleted = FALSE`,
            [deleted_by, car_id]
        );

        // -----------------------------
        // SOFT DELETE CAR
        // -----------------------------
        await client.query(
            `UPDATE cars
             SET    is_deleted = TRUE,
                    is_active  = FALSE,
                    deleted_by = $1,
                    deleted_at = NOW()
             WHERE  car_uuid   = $2
               AND  is_deleted = FALSE`,
            [deleted_by, car_uuid]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type       : "SUCCESS",
            message_visibility: true,
            status            : true,
            code              : 1000,
            message           : "Car deleted successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (delete-car):", err);
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
// STATUS TOGGLE — CAR (ACTIVE / INACTIVE)
// ================================================================

responder.on('status-car', async (req, cb) => {
    const client = await pool.connect();
    try {
        const { car_uuid }    = req;
        const { modified_by } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!car_uuid) {
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2001,
                message           : "Validation failed",
                error             : "Car UUID is required"
            });
        }

        // -----------------------------
        // FETCH CURRENT STATUS
        // -----------------------------
        const check = await pool.query(
            `SELECT car_id, is_active FROM cars
             WHERE  car_uuid   = $1
               AND  is_deleted = FALSE`,
            [car_uuid]
        );
        if (check.rowCount === 0) {
            return cb(null, {
                header_type       : "ERROR",
                message_visibility: true,
                status            : false,
                code              : 2003,
                message           : "Record not found",
                error             : "Car not found"
            });
        }

        const car_id    = check.rows[0].car_id;
        const newStatus = !check.rows[0].is_active;

        await client.query('BEGIN');

        // -----------------------------
        // TOGGLE STATUS ON cars
        // -----------------------------
        await client.query(
            `UPDATE cars
             SET    is_active   = $1,
                    modified_by = $2,
                    modified_at = NOW()
             WHERE  car_uuid    = $3
               AND  is_deleted  = FALSE`,
            [newStatus, modified_by, car_uuid]
        );

        // ✅ TOGGLE STATUS ON car_parameter_mapping
        await client.query(
            `UPDATE car_parameter_mapping
             SET    is_active   = $1,
                    modified_by = $2,
                    modified_at = NOW()
             WHERE  car_id      = $3
               AND  is_deleted  = FALSE`,
            [newStatus, modified_by, car_id]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type       : "SUCCESS",
            message_visibility: true,
            status            : true,
            code              : 1000,
            message           : newStatus
                ? "Car activated successfully"
                : "Car deactivated successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (status-car):", err);
        return cb(null, {
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Status update failed",
            error             : err.message
        });
    } finally {
        client.release();
    }
});


// ================================================================
// UNLOCK CAR RECORD
// ================================================================

responder.on('unlock-car', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { car_uuid } = req;
        const { user_id }  = req.body;

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
             WHERE table_name = 'cars'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE`,
            [car_uuid, user_id]
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
            message: "Car record unlocked successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (unlock-car):", err);
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


// --------------------------------------------------
// ADVANCED FILTER — CARS
// --------------------------------------------------
responder.on('advancefilter-cars', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        let extraWhere  = '';
        let extraParams = [];

        // If PRIVATE → only show own created data
        if (accessScope && accessScope.type === 'PRIVATE') {
            extraWhere = ' AND C.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ---------------- Table & Alias ---------------- */
            table      : 'cars',
            alias      : 'C',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN brand   B  ON C.brand_id   = B.brand_id
                LEFT JOIN model   M  ON C.model_id   = M.model_id
                LEFT JOIN users   creators ON C.created_by  = creators.user_uuid
                LEFT JOIN users   updaters ON C.modified_by = updaters.user_uuid
            `,

            /* ---------------- Allowed Search/Sort Fields ---------------- */
            allowedFields: [
                'car_name',
                'code',
                'brand_name',
                'model_name',
                'erp_id',
                'is_active',
                'last_integrated_date',
                'created_at',
                'modified_at',
                'createdByName',
                'updatedByName'
            ],

            /* ---------------- Custom Joined Fields ---------------- */
            customFields: {
                brand_name: {
                    select: 'B.name',
                    search: 'B.name',
                    sort  : 'B.name'
                },
                model_name: {
                    select: 'M.name',
                    search: 'M.name',
                    sort  : 'M.name'
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
                C.is_deleted = FALSE ${extraWhere}
            `,
            baseParams: extraParams
        });

        return cb(null, {
            status: true,
            code  : 1000,
            result
        });

    } catch (err) {
        console.error('[advancefilter-cars] error:', err);
        return cb(null, {
            header_type      : "ERROR",
            message_visibility: true,
            status           : false,
            code             : 2004,
            message          : err.message,
            error            : err.message
        });
    }
});




// ================================================================
// Generate next part code
// ================================================================

async function generateNextPartCode(pool) {
    // --------------------------------------------------
    // FETCH PREFIX
    // --------------------------------------------------
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM prefix_refno
         WHERE table_name = 'parts'
         AND is_active  = true
         AND is_deleted = false
         ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = prefixRes.rows[0]?.prefix_code || "PRT";

    // --------------------------------------------------
    // FETCH LAST PART CODE
    // --------------------------------------------------
    const result = await pool.query(
        `SELECT code FROM parts
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
// CREATE PART
// ================================================================


responder.on("create-part", async (req, cb) => {
    const client = await pool.connect();

    try {
        const {
            part_number,
            part_name,
            description,
            erp_id,
            is_superseded,
            is_universal,
            is_service_item,
            supersession,
            images,
            created_by
        } = req.body;

        // ----------------------------------------
        // VALIDATION
        // ----------------------------------------
        if (!part_number?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Part number is required"
            });
        }

        if (!part_name?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Part name is required"
            });
        }

        if (!created_by) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "created_by is required"
            });
        }

        // ----------------------------------------
        // SUPERSESSION ARRAY VALIDATION
        // ----------------------------------------
        if (is_superseded === true) {
            if (!Array.isArray(supersession) || supersession.length === 0) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "supersession must be a non-empty array when is_superseded is true"
                });
            }

            for (let i = 0; i < supersession.length; i++) {
                if (!supersession[i].new_part_uuid?.trim()) {
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: `supersession[${i}].new_part_uuid is required`
                    });
                }
            }

            // Check for duplicate new_part_uuid within the payload itself
            const uuids = supersession.map(s => s.new_part_uuid.trim());
            const uniqueUuids = new Set(uuids);
            if (uniqueUuids.size !== uuids.length) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "supersession array contains duplicate new_part_uuid values"
                });
            }
        }

        // ----------------------------------------
        // IMAGES VALIDATION
        // ----------------------------------------
        if (images && !Array.isArray(images)) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "images must be an array"
            });
        }

        if (images?.length) {
            for (let i = 0; i < images.length; i++) {
                if (!images[i].image_path?.trim()) {
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: `images[${i}].image_path is required`
                    });
                }
            }

            const primaryImages = images.filter(img => img.is_primary === true);
            if (primaryImages.length > 1) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Only one image can be marked as primary"
                });
            }

            // ----------------------------------------
            // PAYLOAD-LEVEL DUPLICATE IMAGE CHECK
            // Catch duplicate (image_path + image_type) within the array itself
            // ----------------------------------------
            const imageKeys = images.map(img =>
                `${img.image_path?.trim()}||${img.image_type?.trim() || null}`
            );
            const uniqueImageKeys = new Set(imageKeys);
            if (uniqueImageKeys.size !== imageKeys.length) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "images array contains duplicate image_path + image_type combinations"
                });
            }
        }

        // ----------------------------------------
        // DUPLICATE CHECK — part_number
        // ----------------------------------------
        const duplicateCheck = await pool.query({
            text: `
                SELECT part_id FROM parts
                WHERE LOWER(part_number) = LOWER($1)
                  AND is_deleted = FALSE
            `,
            values: [part_number.trim()]
        });

        if (duplicateCheck.rowCount > 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Creation failed",
                error: "Part number already exists"
            });
        }

        // ----------------------------------------
        // AUTO-GENERATE PART CODE
        // ----------------------------------------
        const part_code = await generateNextPartCode(pool);

        const dupCode = await pool.query(
            `SELECT 1 FROM parts WHERE code = $1 AND is_deleted = FALSE`,
            [part_code]
        );
        if (dupCode.rowCount > 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Creation failed",
                error: "A part with the same code already exists"
            });
        }

        // ----------------------------------------
        // RESOLVE & VALIDATE ALL SUPERSESSION PARTS
        // (before starting transaction — fail fast)
        // ----------------------------------------
        let resolvedSupersessions = [];

        if (is_superseded === true) {
            for (let i = 0; i < supersession.length; i++) {
                const entry = supersession[i];

                // 1. Confirm the replacement part exists
                const newPartResult = await pool.query({
                    text: `
                        SELECT part_id FROM parts
                        WHERE part_uuid = $1
                          AND is_deleted = FALSE
                    `,
                    values: [entry.new_part_uuid.trim()]
                });

                if (newPartResult.rowCount === 0) {
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: `supersession[${i}].new_part_uuid — replacement part not found or is deleted`
                    });
                }

                const new_part_id = newPartResult.rows[0].part_id;

                // 2. Ensure this replacement part is not already someone else's supersession target
                const existingSupersession = await pool.query({
                    text: `
                        SELECT id FROM part_supersession
                        WHERE new_part_id = $1
                          AND is_deleted  = FALSE
                    `,
                    values: [new_part_id]
                });

                if (existingSupersession.rowCount > 0) {
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2002,
                        message: "Creation failed",
                        error: `supersession is already acting as a supersession for another part`
                    });
                }

                resolvedSupersessions.push({
                    new_part_id,
                    reason:         entry.reason?.trim()  || null,
                    effective_from: entry.effective_from  || null,
                    effective_to:   entry.effective_to    || null
                });
            }
        }

        // ----------------------------------------
        // BEGIN TRANSACTION
        // ----------------------------------------
        await client.query("BEGIN");

        // ----------------------------------------
        // INSERT PART
        // ----------------------------------------
        const insertPartResult = await client.query({
            text: `
                INSERT INTO parts
                    (code, part_number, part_name, description, erp_id,
                     is_superseded, is_universal, is_service_item,
                     created_by, assigned_to, assigned_at)
                VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, NOW())
                RETURNING
                    part_id, part_uuid, code, part_number, part_name,
                    description, erp_id, is_superseded, is_universal,
                    is_service_item, is_active, created_at, created_by,
                    assigned_to, assigned_at
            `,
            values: [
                part_code,
                part_number.trim(),
                part_name.trim(),
                description?.trim() || null,
                erp_id?.trim()      || null,
                is_superseded       ?? false,
                is_universal        ?? false,
                is_service_item     ?? false,
                created_by
            ]
        });

        const newPart = insertPartResult.rows[0];

        // ----------------------------------------
        // INSERT ALL SUPERSESSION RECORDS
        // ----------------------------------------
        let supersessionRecords = [];

        if (is_superseded === true) {
            for (const s of resolvedSupersessions) {

                // Safety: no duplicate supersession for this old+new pair
                const dupSupersessionCheck = await client.query({
                    text: `
                        SELECT id FROM part_supersession
                        WHERE old_part_id = $1
                          AND new_part_id = $2
                          AND is_deleted  = FALSE
                    `,
                    values: [newPart.part_id, s.new_part_id]
                });

                if (dupSupersessionCheck.rowCount > 0) {
                    await client.query("ROLLBACK");
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2002,
                        message: "Creation failed",
                        error: "Supersession relationship already exists between these parts"
                    });
                }

                const insertSupersessionResult = await client.query({
                    text: `
                        INSERT INTO part_supersession
                            (old_part_id, new_part_id, reason,
                             effective_from, effective_to,
                             is_active, created_by, assigned_to, assigned_at)
                        VALUES
                            ($1, $2, $3, $4, $5, TRUE, $6, $6, NOW())
                        RETURNING *
                    `,
                    values: [
                        newPart.part_id,
                        s.new_part_id,
                        s.reason,
                        s.effective_from,
                        s.effective_to,
                        created_by
                    ]
                });

                supersessionRecords.push(insertSupersessionResult.rows[0]);
            }
        }

        // ----------------------------------------
        // INSERT PART IMAGES (if provided)
        // ----------------------------------------
        let insertedImages = [];
        if (images?.length) {
            let imageList = images.map((img, idx) => ({ ...img, _idx: idx }));
            const hasPrimary = imageList.some(img => img.is_primary === true);
            if (!hasPrimary) imageList[0].is_primary = true;

            for (const img of imageList) {

                // ----------------------------------------
                // DB-LEVEL DUPLICATE IMAGE CHECK
                // (image_path + image_type) must be unique across ALL parts
                // ----------------------------------------
                const dupImageCheck = await client.query({
                    text: `
                        SELECT 1 FROM part_images
                        WHERE image_path = $1
                          AND image_type = $2
                          AND is_deleted = FALSE
			  AND is_active = TRUE
                    `,
                    values: [
                        img.image_path.trim(),
                        img.image_type?.trim() || null
                    ]
                });

                if (dupImageCheck.rowCount > 0) {
                    await client.query("ROLLBACK");
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2002,
                        message: "Creation failed",
                        error: `Image already exists for another part`
                    });
                }

                const imgResult = await client.query({
                    text: `
                        INSERT INTO part_images
                            (part_id, image_type, image_path,
                             display_order, is_primary,
                             created_by, assigned_to, assigned_at)
                        VALUES
                            ($1, $2, $3, $4, $5, $6, $6, NOW())
                        RETURNING
                            part_image_id, part_image_uuid, part_id,
                            image_type, image_path, display_order,
                            is_primary, created_at
                    `,
                    values: [
                        newPart.part_id,
                        img.image_type?.trim() || null,
                        img.image_path.trim(),
                        img.display_order       ?? (img._idx + 1),
                        img.is_primary          ?? false,
                        created_by
                    ]
                });
                insertedImages.push(imgResult.rows[0]);
            }
        }

        // ----------------------------------------
        // COMMIT
        // ----------------------------------------
        await client.query("COMMIT");

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Part created successfully",
            data: {
                ...newPart,
                supersessions: supersessionRecords,
                images: insertedImages
            }
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (create-part):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Internal server error",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// ================================================================
// GET PART BY UUID (WITH EDIT LOCKING)
// ================================================================

responder.on('getById-part', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { part_uuid } = req;
        const mode    = req.body?.mode;
        const user_id = req.body?.user_id;
console.log("mode",mode);
console.log("user_id",user_id);

        const LOCK_MINUTES = 1;

        // ----------------------------------------
        // VALIDATION
        // ----------------------------------------
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

        // ----------------------------------------
        // FETCH PART WITH ALL RELATED DATA
        // ----------------------------------------
        const result = await client.query(
            `SELECT
                p.part_id,
                p.part_uuid,
                p.code,
                p.part_number,
                p.part_name,
                p.description,
                p.erp_id,
                p.is_superseded,
                p.is_universal,
                p.is_service_item,
                p.is_active,
                p.assigned_to,
                p.assigned_at,
                p.created_at,
                p.created_by,
                p.modified_at,
                p.modified_by,
                creators.username  AS created_by_name,
                updaters.username  AS modified_by_name,
                assignees.username AS assigned_to_name
            FROM parts p
            LEFT JOIN users creators  ON p.created_by  = creators.user_uuid
            LEFT JOIN users updaters  ON p.modified_by = updaters.user_uuid
            LEFT JOIN users assignees ON p.assigned_to  = assignees.user_uuid
            WHERE p.part_uuid  = $1
              AND p.is_deleted = FALSE`,
            [part_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Part not found"
            });
        }

        const part = result.rows[0];

        // ----------------------------------------
        // FETCH PART IMAGES
        // ----------------------------------------
        const imagesResult = await client.query(
            `SELECT
                part_image_id,
                part_image_uuid,
                image_type,
                image_path,
                display_order,
                is_primary,
                created_at
             FROM part_images
             WHERE part_id    = $1
               AND is_deleted = FALSE
             ORDER BY display_order ASC`,
            [part.part_id]
        );
        part.images = imagesResult.rows;

        // ----------------------------------------
        // FETCH ALL SUPERSESSION RECORDS
        // where this part is the OLD (retired) part
        // ----------------------------------------
        const supersessionResult = await client.query(
            `SELECT
                ps.id,
                ps.old_part_id,
                ps.new_part_id,
                ps.reason,
                ps.effective_from,
                ps.effective_to,
                ps.is_active,
                ps.created_at,
                op.part_uuid   AS old_part_uuid,
                op.part_number AS old_part_number,
                op.part_name   AS old_part_name,
                np.part_uuid   AS new_part_uuid,
                np.part_number AS new_part_number,
                np.part_name   AS new_part_name
             FROM part_supersession ps
             LEFT JOIN parts op ON ps.old_part_id = op.part_id
             LEFT JOIN parts np ON ps.new_part_id = np.part_id
             WHERE ps.old_part_id = $1
               AND ps.is_deleted  = FALSE
             ORDER BY ps.created_at DESC`,
            [part.part_id]
        );
        part.supersession = supersessionResult.rows; // [] if none

        // ----------------------------------------
        // LOCK HANDLING (edit mode only)
        // — runs in its own transaction separately
        //   so part fetch is never affected by lock errors
        // ----------------------------------------
        let lockRow = null;

        if (mode === 'edit') {

            if (!user_id) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "User ID required for edit mode"
                });
            }

            // BEGIN lock transaction
            await client.query('BEGIN');

            try {
                // CHECK EXISTING LOCK
                const lockRes = await client.query(
                    `SELECT RL.*, U.username AS locked_by_name
                     FROM record_locks RL
                     LEFT JOIN users U ON U.user_uuid = RL.locked_by
                     WHERE RL.table_name = 'parts'
                       AND RL.record_id  = $1
                       AND RL.is_deleted = FALSE`,
                    [part_uuid]
                );

                lockRow = lockRes.rows[0] || null;


                const isExpired =
                    lockRow &&
                    new Date(lockRow.expires_at).getTime() < Date.now();

                // Locked by another user and not expired
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

                // Expired → soft delete old lock
                if (lockRow && isExpired) {
                    await client.query(
                        `UPDATE record_locks
                         SET    is_deleted = TRUE,
                                deleted_by = $1,
                                deleted_at = NOW()
                         WHERE  lock_id    = $2`,
                        [user_id, lockRow.lock_id]
                    );
                    lockRow = null;
                }

                // No lock exists → create new lock
                if (!lockRow) {

                    const newLock = await client.query(
                        `INSERT INTO record_locks
                             (table_name, record_id, locked_by, expires_at, created_by)
                         VALUES
                             ('parts', $1, $2, NOW() + ($3 || ' minute')::INTERVAL, $2)
                         RETURNING *`,
                        [part_uuid, user_id, LOCK_MINUTES]
                    );

                    lockRow = newLock.rows[0];
                }
                // Same user → refresh expiry
                else if (lockRow.locked_by === user_id) {

                    const refresh = await client.query(
                        `UPDATE record_locks
                         SET    expires_at = NOW() + ($2 || ' minute')::INTERVAL
                         WHERE  lock_id    = $1
                         RETURNING *`,
                        [lockRow.lock_id, LOCK_MINUTES]
                    );
                    lockRow = refresh.rows[0];
                }

                await client.query('COMMIT');

            } catch (lockErr) {
                await client.query('ROLLBACK');
                logger.error(`[getById-part] Lock transaction failed:`, lockErr);
                // Don't fail the whole request — return part data without lock
                lockRow = null;
            }
        }

        // ----------------------------------------
        // LOCK STATUS
        // ----------------------------------------
        part.lock_status =
            lockRow
                ? new Date(lockRow.expires_at).getTime() >= Date.now()
                : false;

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Part fetched successfully",
            data: part,
            lock: lockRow
                ? {
                    status    : part.lock_status,
                    by        : lockRow.locked_by,
                    by_name   : lockRow.locked_by_name,
                    expires_at: lockRow.expires_at
                }
                : { status: false }
        });

    } catch (err) {
        logger.error("Responder Error (getById-part):", err);
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
// UPDATE PART
// ================================================================


responder.on('update-part', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { part_uuid } = req;
        const {
            part_number,
            part_name,
            description,
            erp_id,
            is_universal,
            is_service_item,
            is_active,
            // Supersession
            is_superseded,
            supersession,
            images,
            deleted_image_uuids,
            // Audit
            modified_by,
            assigned_to,
            assigned_at
        } = req.body;

        // ----------------------------------------
        // VALIDATION
        // ----------------------------------------
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

        if (!part_number?.trim()) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Part number is required"
            });
        }

        if (!part_name?.trim()) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Part name is required"
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

        // ----------------------------------------
        // SUPERSESSION ARRAY VALIDATION
        // ----------------------------------------
        if (is_superseded === true) {
            if (!Array.isArray(supersession) || supersession.length === 0) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "supersession must be a non-empty array when is_superseded is true"
                });
            }

            for (let i = 0; i < supersession.length; i++) {
                if (!supersession[i].new_part_uuid?.trim()) {
                    await client.query('ROLLBACK');
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: `supersession[${i}].new_part_uuid is required`
                    });
                }

                // Prevent a part from superseding itself
                if (supersession[i].new_part_uuid.trim() === part_uuid) {
                    await client.query('ROLLBACK');
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: `supersession[${i}].new_part_uuid — a part cannot supersede itself`
                    });
                }
            }

            // Check for duplicate new_part_uuid within the payload itself
            const uuids = supersession.map(s => s.new_part_uuid.trim());
            const uniqueUuids = new Set(uuids);
            if (uniqueUuids.size !== uuids.length) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "supersession array contains duplicate new_part_uuid values"
                });
            }
        }

        // ----------------------------------------
        // IMAGES VALIDATION
        // ----------------------------------------
        if (images && !Array.isArray(images)) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "images must be an array"
            });
        }

        if (images?.length) {
            for (let i = 0; i < images.length; i++) {
                if (!images[i].image_path?.trim()) {
                    await client.query('ROLLBACK');
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: `images[${i}].image_path is required`
                    });
                }
            }

            const primaryImages = images.filter(img => img.is_primary === true);
            if (primaryImages.length > 1) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Only one image can be marked as primary"
                });
            }

            // ----------------------------------------
            // PAYLOAD-LEVEL DUPLICATE IMAGE CHECK
            // Catch duplicate (image_path + image_type) within the array itself
            // ----------------------------------------
            const imageKeys = images.map(img =>
                `${img.image_path?.trim()}||${img.image_type?.trim() || null}`
            );
            const uniqueImageKeys = new Set(imageKeys);
            if (uniqueImageKeys.size !== imageKeys.length) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "images array contains duplicate image_path + image_type combinations"
                });
            }
        }

        // ----------------------------------------
        // CHECK EDIT LOCK
        // ----------------------------------------
        const lockCheck = await client.query(
            `SELECT 1 FROM record_locks
             WHERE table_name = 'parts'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE
               AND expires_at > NOW()`,
            [part_uuid, modified_by]
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

        // ----------------------------------------
        // CHECK PART EXISTS
        // ----------------------------------------
        const existsResult = await client.query(
            `SELECT part_id, is_superseded AS currently_superseded
             FROM parts
             WHERE part_uuid  = $1
               AND is_deleted = FALSE`,
            [part_uuid]
        );
        if (existsResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Part not found"
            });
        }
        const { part_id, currently_superseded } = existsResult.rows[0];

        // ----------------------------------------
        // DUPLICATE PART NUMBER CHECK
        // ----------------------------------------
        const duplicateCheck = await client.query(
            `SELECT 1 FROM parts
             WHERE LOWER(part_number) = LOWER($1)
               AND is_deleted         = FALSE
               AND part_uuid         != $2`,
            [part_number.trim(), part_uuid]
        );
        if (duplicateCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Update failed",
                error: "Part number already exists"
            });
        }

        // ----------------------------------------
        // RESOLVE & VALIDATE ALL SUPERSESSION PARTS
        // ----------------------------------------
        let resolvedSupersessions = [];

        if (is_superseded === true) {
            for (let i = 0; i < supersession.length; i++) {
                const entry = supersession[i];

                // Confirm the replacement part exists
                const newPartResult = await client.query(
                    `SELECT part_id FROM parts
                     WHERE part_uuid  = $1
                       AND is_deleted = FALSE`,
                    [entry.new_part_uuid.trim()]
                );
                if (newPartResult.rowCount === 0) {
                    await client.query('ROLLBACK');
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: `supersession[${i}].new_part_uuid — replacement part not found or is deleted`
                    });
                }

                const new_part_id = newPartResult.rows[0].part_id;

                // ----------------------------------------
                // GLOBAL SUPERSESSION CONFLICT CHECK
                // If part_supersession_uuid is passed → this is an UPDATE (skip check)
                // If no part_supersession_uuid → this is a NEW entry, ensure
                // the new_part_id is not already a supersession target for any OTHER part
                // ----------------------------------------
                if (!entry.part_supersession_uuid?.trim()) {
                    const existingSupersession = await client.query(
                        `SELECT id FROM part_supersession
                         WHERE new_part_id = $1
                           AND old_part_id != $2
                           AND is_deleted  = FALSE`,
                        [new_part_id, part_id]
                    );
                    if (existingSupersession.rowCount > 0) {
                        await client.query('ROLLBACK');
                        return cb(null, {
                            header_type: "ERROR",
                            message_visibility: true,
                            status: false,
                            code: 2002,
                            message: "Update failed",
                            error: `supersession[${i}].new_part_uuid is already acting as a supersession for another part`
                        });
                    }
                }

                resolvedSupersessions.push({
                    part_supersession_uuid: entry.part_supersession_uuid?.trim() || null,
                    new_part_id,
                    reason:                 entry.reason?.trim()  || null,
                    effective_from:         entry.effective_from  || null,
                    effective_to:           entry.effective_to    || null
                });
            }
        }

        // ----------------------------------------
        // UPDATE PART
        // ----------------------------------------
        const updateResult = await client.query(
            `UPDATE parts
             SET
                 part_number     = $1,
                 part_name       = $2,
                 description     = $3,
                 erp_id          = $4,
                 is_universal    = $5,
                 is_service_item = $6,
                 is_active       = $7,
                 is_superseded   = $8,
                 modified_by     = $9,
                 modified_at     = NOW(),
                 assigned_to     = $10,
                 assigned_at     = NOW()
             WHERE part_uuid     = $11
             RETURNING
                 part_id, part_uuid, part_number, part_name, description,
                 erp_id, is_superseded, is_universal, is_service_item,
                 is_active, created_at, created_by, modified_at, modified_by,
                 assigned_to, assigned_at`,
            [
                part_number.trim(),
                part_name.trim(),
                description?.trim() || null,
                erp_id?.trim()      || null,
                is_universal,
                is_service_item,
                is_active           ?? true,
                is_superseded,
                modified_by,
                modified_by,
                part_uuid
            ]
        );
        const updatedPart = updateResult.rows[0];

        // ----------------------------------------
        // HANDLE SUPERSESSION — UPSERT LOGIC
        // part_supersession_uuid present → UPDATE
        // no part_supersession_uuid         → INSERT
        // rows not in payload               → SOFT DELETE
        // ----------------------------------------
        let supersessionRecords = [];

        if (is_superseded === true) {

            // Fetch currently active supersession rows for this part
            const existingRows = await client.query(
                `SELECT id, part_supersession_uuid, new_part_id
                 FROM part_supersession
                 WHERE old_part_id = $1
                   AND is_deleted  = FALSE`,
                [part_id]
            );

            // Map: part_supersession_uuid → row
            const existingByUuid = new Map(
                existingRows.rows.map(r => [r.part_supersession_uuid, r])
            );

            // Set of new_part_ids coming in payload (to detect removals)
            const incomingNewPartIds = new Set(
                resolvedSupersessions.map(s => s.new_part_id)
            );

            // Soft-delete rows whose new_part_id is no longer in the payload
            for (const row of existingRows.rows) {
                if (!incomingNewPartIds.has(row.new_part_id)) {
                    await client.query(
                        `UPDATE part_supersession
                         SET    is_active   = FALSE,
                                is_deleted  = TRUE,
                                deleted_by  = $1,
                                deleted_at  = NOW(),
                                modified_at = NOW(),
                                modified_by = $1
                         WHERE  part_supersession_uuid = $2
                           AND  is_deleted             = FALSE`,
                        [modified_by, row.part_supersession_uuid]
                    );
                }
            }

            // Upsert each incoming supersession entry
            for (const s of resolvedSupersessions) {

                if (s.part_supersession_uuid && existingByUuid.has(s.part_supersession_uuid)) {
                    // ---- UPDATE existing record ----
                    const updateSupersession = await client.query(
                        `UPDATE part_supersession
                         SET
                             reason         = $1,
                             effective_from = $2,
                             effective_to   = $3,
                             is_active      = TRUE,
                             modified_by    = $4,
                             modified_at    = NOW()
                         WHERE part_supersession_uuid = $5
                           AND is_deleted             = FALSE
                         RETURNING *`,
                        [
                            s.reason,
                            s.effective_from,
                            s.effective_to,
                            modified_by,
                            s.part_supersession_uuid
                        ]
                    );
                    supersessionRecords.push(updateSupersession.rows[0]);

                } else {
                    // ---- INSERT new supersession record ----
                    const insertSupersession = await client.query(
                        `INSERT INTO part_supersession
                             (old_part_id, new_part_id, reason,
                              effective_from, effective_to,
                              is_active, created_by, assigned_to, assigned_at)
                         VALUES ($1, $2, $3, $4, $5, TRUE, $6, $6, NOW())
                         RETURNING *`,
                        [
                            part_id,
                            s.new_part_id,
                            s.reason,
                            s.effective_from,
                            s.effective_to,
                            modified_by
                        ]
                    );
                    supersessionRecords.push(insertSupersession.rows[0]);
                }
            }

        } else if (is_superseded === false && currently_superseded === true) {
            // Supersession being REMOVED entirely — soft-delete all active rows
            await client.query(
                `UPDATE part_supersession
                 SET    is_active   = FALSE,
                        is_deleted  = TRUE,
                        deleted_by  = $1,
                        deleted_at  = NOW(),
                        modified_at = NOW(),
                        modified_by = $1
                 WHERE  old_part_id = $2
                   AND  is_deleted  = FALSE`,
                [modified_by, part_id]
            );
        }

        // ----------------------------------------
        // SOFT-DELETE REMOVED IMAGES
        // ----------------------------------------
        if (deleted_image_uuids?.length) {
            await client.query(
                `UPDATE part_images
                 SET    is_deleted  = TRUE,
                        deleted_at  = NOW(),
                        deleted_by  = $1,
                        modified_at = NOW(),
                        modified_by = $1
                 WHERE  part_image_uuid = ANY($2::uuid[])
                   AND  part_id         = $3
                   AND  is_deleted      = FALSE`,
                [modified_by, deleted_image_uuids, part_id]
            );
        }

        // ----------------------------------------
        // HANDLE IMAGES — UPSERT LOGIC
        // part_image_uuid present → UPDATE
        // no part_image_uuid      → INSERT
        // ----------------------------------------
        let upsertedImages = [];

        if (images?.length) {

            // If any incoming image is marked primary,
            // clear primary flag on all existing images first
            const hasNewPrimary = images.some(img => img.is_primary === true);
            if (hasNewPrimary) {
                await client.query(
                    `UPDATE part_images
                     SET    is_primary  = FALSE,
                            modified_at = NOW(),
                            modified_by = $1
                     WHERE  part_id     = $2
                       AND  is_deleted  = FALSE`,
                    [modified_by, part_id]
                );
            }

            for (let i = 0; i < images.length; i++) {
                const img = images[i];

                if (img.part_image_uuid?.trim()) {
                    // ----------------------------------------
                    // EXISTING IMAGE → UPDATE
                    // ----------------------------------------

                    // Duplicate check: same image_path + image_type must not
                    // exist in ANY other record (globally), excluding this record itself
                    // and any images being deleted in this request
                    const dupImageCheck = await client.query(
                        `SELECT 1 FROM part_images
                         WHERE image_path      = $1
                           AND image_type      = $2
                           AND is_deleted      = FALSE
                           AND part_image_uuid != $3
                           AND (
                               $4::uuid[] IS NULL
                               OR part_image_uuid != ALL($4::uuid[])
                           )`,
                        [
                            img.image_path.trim(),
                            img.image_type?.trim() || null,
                            img.part_image_uuid.trim(),
                            deleted_image_uuids?.length ? deleted_image_uuids : null
                        ]
                    );
                    if (dupImageCheck.rowCount > 0) {
                        await client.query('ROLLBACK');
                        return cb(null, {
                            header_type: "ERROR",
                            message_visibility: true,
                            status: false,
                            code: 2002,
                            message: "Update failed",
                            error: `Image already exists for another record`
                        });
                    }

                    const imgResult = await client.query(
                        `UPDATE part_images
                         SET
                             image_type    = $1,
                             image_path    = $2,
                             display_order = $3,
                             is_primary    = $4,
                             modified_by   = $5,
                             modified_at   = NOW()
                         WHERE part_image_uuid = $6
                           AND part_id         = $7
                           AND is_deleted      = FALSE
                         RETURNING
                             part_image_id, part_image_uuid, part_id,
                             image_type, image_path, display_order,
                             is_primary, created_at`,
                        [
                            img.image_type?.trim()  || null,
                            img.image_path.trim(),
                            img.display_order        ?? (i + 1),
                            img.is_primary           ?? false,
                            modified_by,
                            img.part_image_uuid.trim(),
                            part_id
                        ]
                    );
                    if (imgResult.rowCount > 0) {
                        upsertedImages.push(imgResult.rows[0]);
                    }

                } else {
                    // ----------------------------------------
                    // NEW IMAGE → INSERT
                    // Duplicate check: same image_path + image_type must not
                    // exist anywhere globally, excluding deleted ones
                    // ----------------------------------------
                    const dupImageCheck = await client.query(
                        `SELECT 1 FROM part_images
                         WHERE image_path = $1
                           AND image_type = $2
                           AND is_deleted = FALSE
                           AND (
                               $3::uuid[] IS NULL
                               OR part_image_uuid != ALL($3::uuid[])
                           )`,
                        [
                            img.image_path.trim(),
                            img.image_type?.trim() || null,
                            deleted_image_uuids?.length ? deleted_image_uuids : null
                        ]
                    );
                    if (dupImageCheck.rowCount > 0) {
                        await client.query('ROLLBACK');
                        return cb(null, {
                            header_type: "ERROR",
                            message_visibility: true,
                            status: false,
                            code: 2002,
                            message: "Update failed",
                            error: `Image already exists for another record`
                        });
                    }

                    const imgResult = await client.query(
                        `INSERT INTO part_images
                             (part_id, image_type, image_path,
                              display_order, is_primary,
                              created_by, assigned_to, assigned_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $6, NOW())
                         RETURNING
                             part_image_id, part_image_uuid, part_id,
                             image_type, image_path, display_order,
                             is_primary, created_at`,
                        [
                            part_id,
                            img.image_type?.trim() || null,
                            img.image_path.trim(),
                            img.display_order       ?? (i + 1),
                            img.is_primary          ?? false,
                            modified_by
                        ]
                    );
                    upsertedImages.push(imgResult.rows[0]);
                }
            }
        }

        // ----------------------------------------
        // FETCH ALL ACTIVE IMAGES FOR RESPONSE
        // ----------------------------------------
        const activeImages = await client.query(
            `SELECT
                 part_image_id, part_image_uuid, image_type,
                 image_path, display_order, is_primary, created_at
             FROM part_images
             WHERE part_id    = $1
               AND is_deleted = FALSE
             ORDER BY display_order ASC`,
            [part_id]
        );

        // ----------------------------------------
        // AUTO-UNLOCK AFTER SUCCESS
        // ----------------------------------------
        await client.query(
            `UPDATE record_locks
             SET    is_deleted = TRUE,
                    deleted_by = $1,
                    deleted_at = NOW()
             WHERE  table_name = 'parts'
               AND  record_id  = $2
               AND  locked_by  = $3
               AND  is_deleted = FALSE`,
            [modified_by, part_uuid, modified_by]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Part updated successfully",
            data: {
                ...updatedPart,
                supersessions: supersessionRecords,
                images: activeImages.rows
            }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (update-part):", err);
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
// DELETE PART (SOFT DELETE)
// — blocked if part has mappings in product_part_mapping
// ================================================================

responder.on('delete-part', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { part_uuid } = req;
        const { deleted_by } = req.body;

        // ----------------------------------------
        // VALIDATION
        // ----------------------------------------
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

        // ----------------------------------------
        // CHECK PART EXISTS
        // ----------------------------------------
        const check = await client.query(
            `SELECT part_id FROM parts
             WHERE part_uuid  = $1
               AND is_deleted = FALSE`,
            [part_uuid]
        );
        if (check.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Part not found"
            });
        }

        const part_id = check.rows[0].part_id;

        // ----------------------------------------
        // BLOCK DELETE — active product mappings
        // ----------------------------------------
        const mappingCheck = await client.query(
            `SELECT 1 FROM product_part_mapping
             WHERE part_id    = $1
               AND is_deleted = FALSE
             LIMIT 1`,
            [part_id]
        );
        if (mappingCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Delete failed",
                error: "Part cannot be deleted because it has active product mappings. Remove the mappings first"
            });
        }

        // ----------------------------------------
        // SOFT DELETE — part images
        // ----------------------------------------
        await client.query(
            `UPDATE part_images
             SET    is_deleted  = TRUE,
                    deleted_by  = $1,
                    deleted_at  = NOW(),
                    modified_at = NOW(),
                    modified_by = $1
             WHERE  part_id    = $2
               AND  is_deleted = FALSE`,
            [deleted_by, part_id]
        );

        // ----------------------------------------
        // SOFT DELETE — supersession records
        // (both as old part and new part)
        // ----------------------------------------
        await client.query(
            `UPDATE part_supersession
             SET    is_deleted  = TRUE,
                    is_active   = FALSE,
                    deleted_by  = $1,
                    deleted_at  = NOW(),
                    modified_at = NOW(),
                    modified_by = $1
             WHERE  (old_part_id = $2 OR new_part_id = $2)
               AND  is_deleted   = FALSE`,
            [deleted_by, part_id]
        );

        // ----------------------------------------
        // SOFT DELETE — part
        // ----------------------------------------
        await client.query(
            `UPDATE parts
             SET    is_deleted  = TRUE,
                    is_active      = FALSE,
                    deleted_by  = $1,
                    deleted_at  = NOW(),
                    modified_at = NOW(),
                    modified_by = $1
             WHERE  part_uuid   = $2`,
            [deleted_by, part_uuid]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Part deleted successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (delete-part):", err);
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
// STATUS TOGGLE — PART (ACTIVE / INACTIVE)
// ================================================================


responder.on('status-part', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { part_uuid }   = req;
        const { modified_by } = req.body;

        // ----------------------------------------
        // VALIDATION
        // ----------------------------------------
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

        // ----------------------------------------
        // FETCH CURRENT STATUS & part_id
        // ----------------------------------------
        const check = await client.query(
            `SELECT part_id, is_active FROM parts
             WHERE part_uuid  = $1
               AND is_deleted = FALSE`,
            [part_uuid]
        );

        if (check.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Part not found"
            });
        }

        const { part_id, is_active } = check.rows[0];
        const newStatus           = !is_active;

        // ----------------------------------------
        // TOGGLE PART STATUS
        // ----------------------------------------
        await client.query(
            `UPDATE parts
             SET    is_active      = $1,
                    modified_by = $2,
                    modified_at = NOW()
             WHERE  part_uuid   = $3`,
            [newStatus, modified_by, part_uuid]
        );

        // ----------------------------------------
        // TOGGLE PART IMAGES STATUS
        // Images follow the parent part's status
        // ----------------------------------------
        await client.query(
            `UPDATE part_images
             SET    is_active      = $1,
                    modified_by = $2,
                    modified_at = NOW()
             WHERE  part_id     = $3
               AND  is_deleted  = FALSE`,
            [newStatus, modified_by, part_id]
        );

        // ----------------------------------------
        // TOGGLE PART SUPERSESSION STATUS
        // Toggle records where this part is involved
        // as either the old (retired) or new (replacement) part.
        // Only touch active (non-deleted) records.
        // ----------------------------------------
        await client.query(
            `UPDATE part_supersession
             SET    is_active   = $1,
                    modified_by = $2,
                    modified_at = NOW()
             WHERE  (old_part_id = $3 OR new_part_id = $3)
               AND  is_deleted   = FALSE`,
            [newStatus, modified_by, part_id]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: newStatus
                ? "Part activated successfully"
                : "Part deactivated successfully",
            data: { status: newStatus }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (status-part):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Status update failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});
// ================================================================
// UNLOCK PART RECORD
// ================================================================

responder.on('unlock-part', async (req, cb) => {
    const client = await pool.connect();
    try {
        const { part_uuid } = req;
        const { user_id }   = req.body;

        // ----------------------------------------
        // VALIDATION
        // ----------------------------------------
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

        // ----------------------------------------
        // DELETE LOCK — only if same user owns it
        // ----------------------------------------
        const result = await client.query(
            `DELETE FROM record_locks
             WHERE  table_name = 'parts'
               AND  record_id  = $1
               AND  locked_by  = $2
               AND  is_deleted = FALSE`,
            [part_uuid, user_id]
        );

        if (!result.rowCount) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Unable to unlock record",
                error: "This record is currently being edited by another user or already unlocked"
            });
        }

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Part record unlocked successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (unlock-part):", err);
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
// ADVANCED FILTER — PARTS
// ================================================================


responder.on('advancefilter-parts', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        let extraWhere  = '';
        let extraParams = [];

        // PRIVATE scope → only show own created records
        if (accessScope && accessScope.type === 'PRIVATE') {
            extraWhere = ' AND P.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody    : req.body,
            table      : 'parts',
            alias      : 'P',
            defaultSort: 'created_at',

            /* ---------------- Joins ---------------- */
            joinSql: `
                LEFT JOIN users creators  ON P.created_by  = creators.user_uuid
                LEFT JOIN users updaters  ON P.modified_by = updaters.user_uuid
                LEFT JOIN users assignees ON P.assigned_to  = assignees.user_uuid

                -- Primary image only (for list thumbnails)
                LEFT JOIN LATERAL (
                    SELECT image_path, image_type
                    FROM   part_images pi
                    WHERE  pi.part_id    = P.part_id
                      AND  pi.is_primary = TRUE
                      AND  pi.is_deleted = FALSE
                    LIMIT 1
                ) primary_img ON TRUE

                -- ALL supersession records where this part is the OLD (retired) part
                -- Returns JSON array of all replacement parts for this part
                LEFT JOIN LATERAL (
                    SELECT JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'supersession_id'   , ps.id,
                            'new_part_uuid'     , np.part_uuid,
                            'new_part_number'   , np.part_number,
                            'new_part_name'     , np.part_name,
                            'reason'            , ps.reason,
                            'effective_from'    , ps.effective_from,
                            'effective_to'      , ps.effective_to,
                            'is_active'         , ps.is_active,
                            'created_at'        , ps.created_at
                        )
                        ORDER BY ps.created_at DESC
                    ) AS supersession_list
                    FROM   part_supersession ps
                    LEFT JOIN parts np ON ps.new_part_id = np.part_id
                    WHERE  ps.old_part_id = P.part_id
                      AND  ps.is_deleted  = FALSE
                ) supersession_data ON TRUE
            `,

            /* ---------------- Allowed Fields ---------------- */
            allowedFields: [
                'code',
                'part_number',
                'part_name',
                'description',
                'erp_id',
                'is_superseded',
                'is_universal',
                'is_service_item',
                'status',
                'created_at',
                'modified_at',
                'createdByName',
                'updatedByName',
                'assignedToName'
            ],

            /* ---------------- Custom Joined Fields ---------------- */
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
                assignedToName: {
                    select: 'assignees.username',
                    search: 'assignees.username',
                    sort  : 'assignees.username'
                },
                primary_image_path: {
                    select: 'primary_img.image_path',
                    search: 'primary_img.image_path',
                    sort  : 'primary_img.image_path'
                },
                supersession_list: {
                    select: 'supersession_data.supersession_list',
                    search: 'supersession_data.supersession_list',
                    sort  : 'supersession_data.supersession_list'
                }
            },

            /* ---------------- Base Where ---------------- */
            baseWhere : `P.is_deleted = FALSE ${extraWhere}`,
            baseParams: extraParams
        });

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code  : 1000,
            result
        });

    } catch (err) {
        logger.error('[advancefilter-parts] error:', err);
        return cb(null, {
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Filter failed",
            error             : err.message
        });
    }
});

// ================================================================
// DELETE — PART SUPERSESSION
// ================================================================

responder.on('delete-part-supersession', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { part_supersession_uuid } = req;
        const { deleted_by } = req.body;

        // ----------------------------------------
        // VALIDATION
        // ----------------------------------------
        if (!part_supersession_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Part supersession UUID is required"
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
                error: "deleted_by is required"
            });
        }

        // ----------------------------------------
        // CHECK RECORD EXISTS
        // ----------------------------------------
        const check = await client.query(
            `SELECT id, old_part_id FROM part_supersession
             WHERE part_supersession_uuid = $1
               AND is_deleted             = FALSE`,
            [part_supersession_uuid]
        );

        if (check.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Part supersession record not found or already deleted"
            });
        }

        const { id, old_part_id } = check.rows[0];

        // ----------------------------------------
        // SOFT DELETE — part_supersession record
        // ----------------------------------------
        await client.query(
            `UPDATE part_supersession
             SET    is_deleted  = TRUE,
                    is_active   = FALSE,
                    deleted_by  = $1,
                    deleted_at  = NOW(),
                    modified_at = NOW(),
                    modified_by = $1
             WHERE  id          = $2
               AND  is_deleted  = FALSE`,
            [deleted_by, id]
        );

        // ----------------------------------------
        // CHECK if this old part has any remaining
        // active supersession records.
        // If none remain — flip is_superseded = FALSE on the part.
        // ----------------------------------------
        const remaining = await client.query(
            `SELECT 1 FROM part_supersession
             WHERE old_part_id = $1
               AND is_deleted  = FALSE
             LIMIT 1`,
            [old_part_id]
        );

        if (remaining.rowCount === 0) {
            await client.query(
                `UPDATE parts
                 SET    is_superseded = FALSE,
                        modified_at   = NOW(),
                        modified_by   = $1
                 WHERE  part_id       = $2
                   AND  is_deleted    = FALSE`,
                [deleted_by, old_part_id]
            );
        }

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Part supersession deleted successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (delete-part-supersession):", err);
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