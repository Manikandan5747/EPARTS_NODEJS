require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const bcrypt = require("bcryptjs");
const commonenum = require('@libs/config/enum');


// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'buyer-portal-user responder',
    key: 'buyer-portal-user',
    redis: { host: redisHost, port: redisPort }
});

// ================================================================
// Generate next user code
// ================================================================

async function generateNextUserCode(pool) {
    // --------------------------------------------------
    // FETCH PREFIX
    // --------------------------------------------------
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM prefix_refno
         WHERE table_name = 'portal_users' 
         AND category_type = 'BUYER_PORTAL_USERS' 
         AND is_active = true 
         AND is_deleted = false
         ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = prefixRes.rows[0]?.prefix_code || "BPU";

    // --------------------------------------------------
    // FETCH LAST CODE FILTERED BY BUYER USER TYPE
    // --------------------------------------------------
    const result = await pool.query(
        `SELECT portal_user_code FROM portal_users
         WHERE portal_user_code IS NOT NULL
         AND user_type_id = $1
         ORDER BY (regexp_replace(portal_user_code, '\\D', '', 'g'))::int DESC
         LIMIT 1`,
        [commonenum.USER_TYPE_ID.BUYER]
    );

    const lastCode = result.rows[0]?.portal_user_code || null;
    if (!lastCode) return `${prefix}00001`;

    const match = lastCode.match(/\d+$/);
    const number = match ? parseInt(match[0], 10) : 0;
    return `${prefix}${(number + 1).toString().padStart(5, "0")}`;
}
// --------------------------------------------------
// CREATE PORTAL USER
// --------------------------------------------------

responder.on("create-buyer-portal-users", async (req, cb) => {
    try {
        const {
            username,
            full_name,
            email,
            phone_number,
            password,
            buyer_uuid,
            profile_icon,
            created_by
        } = req.body;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!username?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Username is required"
            });
        }
        if (!full_name?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Full Name is required"
            });
        }
        if (!password?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Password is required"
            });
        }
        
        if (!buyer_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Buyer UUID is required"
            });
        }

        const usernameTrim = username.trim();

        // -----------------------------
        // USER TYPE ID FROM ENUM
        // -----------------------------
        const user_type_id = commonenum.USER_TYPE_ID.BUYER;

        // -----------------------------
        // FETCH buyer_id (if buyer_uuid provided)
        // -----------------------------
        let buyer_id = null;
        if (buyer_uuid) {
            const buyerQuery = {
                text: `
                    SELECT buyer_id FROM buyer_accounts
                    WHERE buyer_uuid = $1
                    AND is_deleted = FALSE
                    AND is_active = TRUE
                `,
                values: [buyer_uuid]
            };
            const buyerResult = await pool.query(buyerQuery);
            if (buyerResult.rowCount === 0) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Invalid Buyer UUID"
                });
            }
            buyer_id = buyerResult.rows[0].buyer_id;
        }


        // -----------------------------
        // DUPLICATE CHECK
        // -----------------------------
        const duplicateQuery = {
            text: `
                SELECT portal_user_id FROM portal_users 
                WHERE (username = $1 OR email = $2 OR phone_number = $3)
                AND is_deleted = FALSE
                 AND user_type_id = $4
                 AND buyer_id = $5
            `,
            values: [usernameTrim, email, phone_number, user_type_id,buyer_id]
        };

        const duplicateCheck = await pool.query(duplicateQuery);

        if (duplicateCheck.rowCount > 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Creation failed",
                error: "User already exists (username/email/phone)"
            });
        }

        // --------------------------------------------------
        // AUTO-GENERATE USER CODE
        // --------------------------------------------------
        const portal_user_code = await generateNextUserCode(pool);

        // --------------------------------------------------
        // HASH PASSWORD
        // --------------------------------------------------
        const password_hash = await bcrypt.hash(password, 10);

        // -----------------------------
        // INSERT USER
        // -----------------------------
        const insertQuery = {
            text: `
                INSERT INTO portal_users 
                    (username, full_name, email, phone_number,
                     password_hash, user_type_id, buyer_id, created_by, assigned_to,portal_user_code,profile_icon)
                VALUES 
                    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING 
                    portal_user_id, portal_user_uuid,portal_user_code, username, full_name, email, 
                    phone_number, user_type_id, buyer_id, is_active, profile_icon
            `,
            values: [
                usernameTrim,
                full_name,
                email,
                phone_number,
                password_hash,
                user_type_id,
                buyer_id,
                created_by,
                created_by,
                portal_user_code,
                profile_icon
            ]
        };

        const insert = await pool.query(insertQuery);

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Buyer portal user created successfully",
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (create-buyer-portal-users):", err);
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

// --------------------------------------------------
//  LIST BUYER PORTAL USERS
// --------------------------------------------------

responder.on('list-buyer-portal-users', async (req, cb) => {
    try {

        const query = `
            SELECT 
                pu.portal_user_id,
                pu.portal_user_uuid,
                pu.portal_user_code,
                pu.username,
                pu.full_name,
                pu.email,
                pu.phone_number,
                pu.user_type_id,
                pu.buyer_id,
                pu.profile_icon,
                pu.is_online,
                pu.force_logout,
                pu.last_login,
                pu.is_active,
                pu.created_at,
                pu.created_by,
                pu.modified_at,
                pu.modified_by,
                pu.deleted_at,
                pu.deleted_by,
                pu.is_deleted,
                pu.is_approved,
                pu.assigned_to,
                pu.assigned_at,

                -- Created & Updated Usernames
                creator.username AS createdByName,
                updater.username AS updatedByName,

                -- User Type Name
                ut.name AS user_type_name,
                -- Buyer Account Owner Username
                ba.user_id AS buyer_user_id,
                buyer_owner.username AS buyerUsername
            FROM portal_users pu

            LEFT JOIN users creator 
                ON pu.created_by = creator.user_uuid

            LEFT JOIN users updater 
                ON pu.modified_by = updater.user_uuid

            LEFT JOIN user_types ut
                ON pu.user_type_id = ut.user_type_id
            -- Get user_id from buyer_accounts using buyer_id
            LEFT JOIN buyer_accounts ba
                ON pu.buyer_id = ba.buyer_id
            -- Get username from users using that user_id
            LEFT JOIN users buyer_owner
                ON ba.user_id = buyer_owner.user_id
            WHERE 
                pu.is_deleted = FALSE
                AND pu.buyer_id IS NOT NULL 
                

            ORDER BY 
                pu.created_at ASC
        `;

        const result = await pool.query(query);

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Buyer portal users list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("Responder Error (list buyer portal users):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Fetch failed",
            error: err.message
        });
    }
});

// --------------------------------------------------
// GET BY ID WITH EDIT LOCKING
// --------------------------------------------------


responder.on('getById-buyer-portal-users', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { portal_user_uuid } = req;
        const mode = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        /* ======================================================
           VALIDATION
        ====================================================== */
        if (!portal_user_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Portal user UUID is required"
            });
        }

        await client.query('BEGIN');

        /* ======================================================
           FETCH PORTAL USER BY UUID
        ====================================================== */
        const result = await client.query(
            `
            SELECT 
                u.portal_user_id,
                u.portal_user_uuid,
                u.username,
                u.full_name,
                u.email,
                u.phone_number,
                u.user_type_id,
                u.buyer_id,
                u.profile_icon,
                u.is_online,
                u.force_logout,
                u.last_login,
                u.is_active,
                u.created_at,
                u.created_by,
                u.modified_at,
                u.modified_by,
                u.deleted_at,
                u.deleted_by,
                u.is_deleted,
                u.is_approved,
                u.assigned_to,
                u.assigned_at,
                -- Created & Updated Usernames
                creators.username AS created_by_name,
                updaters.username AS updated_by_name,
                -- User Type Name
                ut.name AS user_type_name
            FROM portal_users u
            LEFT JOIN users creators 
                ON u.created_by = creators.user_uuid
            LEFT JOIN users updaters 
                ON u.modified_by = updaters.user_uuid
            LEFT JOIN user_types ut
                ON u.user_type_id = ut.user_type_id
            WHERE 
                u.portal_user_uuid = $1
                AND u.is_deleted = FALSE
                AND u.buyer_id IS NOT NULL 

            `,
            [portal_user_uuid]
        );

        /* ======================================================
           CHECK IF RECORD EXISTS
        ====================================================== */
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Buyer portal user not found"
            });
        }

        const portalUser = result.rows[0];

        /* ======================================================
           LOCK HANDLING (edit mode only)
        ====================================================== */
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
                 WHERE RL.table_name = 'portal_users'
                   AND RL.record_id = $1
                   AND RL.is_deleted = FALSE`,
                [portal_user_uuid]
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

            // Expired → clear lock
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
                    `INSERT INTO record_locks(
                        table_name, record_id, locked_by, expires_at, created_by
                    )
                    VALUES(
                        'portal_users', $1, $2,
                        NOW() + ($3 || ' minute')::INTERVAL, $2
                    )
                    RETURNING *`,
                    [portal_user_uuid, user_id, LOCK_MINUTES]
                );

                lockRow = newLock.rows[0];
            }
            // Refresh existing lock (same user)
            else if (lockRow.locked_by === user_id) {
                const refresh = await client.query(
                    `UPDATE record_locks
                     SET expires_at = NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id = $1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );

                lockRow = refresh.rows[0];
            }
        }

        await client.query('COMMIT');

        /* ======================================================
           FINAL LOCK STATUS
        ====================================================== */
        portalUser.lock_status =
            lockRow &&
            new Date(lockRow.expires_at).getTime() >= Date.now();

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Buyer portal user fetched successfully",
            data: portalUser,
            lock: lockRow
                ? {
                    status: portalUser.lock_status,
                    by: lockRow.locked_by,
                    by_name: lockRow.locked_by_name,
                    expires_at: lockRow.expires_at
                }
                : {
                    status: false
                }
        });

    } catch (err) {
        await client.query('ROLLBACK');

        logger.error("Responder Error (getById buyer portal users):", err);
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

// --------------------------------------------------
// UPDATE PORTAL USER
// --------------------------------------------------

responder.on('update-buyer-portal-users', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { portal_user_uuid } = req;
        const {
            username,
            full_name,
            email,
            phone_number,
            buyer_uuid,
            modified_by,
            is_active,
            profile_icon
        } = req.body;

        /* ======================================================
           VALIDATIONS
        ====================================================== */
        if (!portal_user_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Portal user UUID is required"
            });
        }

        if (!username || !username.trim()) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Username is required"
            });
        }

        if (!full_name || !full_name.trim()) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Full name is required"
            });
        }

        // -----------------------------
        // USER TYPE ID FROM ENUM
        // -----------------------------
        const user_type_id = commonenum.USER_TYPE_ID.BUYER;

        // -----------------------------
        // FETCH buyer_id (if buyer_uuid provided)
        // -----------------------------
        let buyer_id = null;
        if (buyer_uuid) {
            const buyerQuery = {
                text: `
                    SELECT buyer_id FROM buyer_accounts
                    WHERE buyer_uuid = $1
                    AND is_deleted = FALSE
                    AND is_active = TRUE
                `,
                values: [buyer_uuid]
            };
            const buyerResult = await pool.query(buyerQuery);
            if (buyerResult.rowCount === 0) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Invalid Buyer UUID"
                });
            }
            buyer_id = buyerResult.rows[0].buyer_id;
        }


        const usernameTrim = username.trim();
        const fullNameTrim = full_name.trim();

        /* ======================================================
           CHECK EDIT LOCK
        ====================================================== */
        const lockCheck = await client.query(
            `
            SELECT 1
            FROM record_locks
            WHERE table_name = 'portal_users'
              AND record_id = $1
              AND locked_by = $2
              AND is_deleted = FALSE
              AND expires_at > NOW()
            `,
            [portal_user_uuid, modified_by]
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

        /* ======================================================
           CHECK PORTAL USER EXISTS
        ====================================================== */
        const exists = await client.query(
            `SELECT profile_icon FROM portal_users
             WHERE portal_user_uuid = $1 AND is_deleted = FALSE`,
            [portal_user_uuid]
        );

        if (exists.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Portal user not found"
            });
        }

        const existingProfileIcon = exists.rows[0].profile_icon;

        /* ======================================================
           DUPLICATE CHECK (username, email, phone)
        ====================================================== */
        const duplicate = await client.query(
            `
            SELECT portal_user_id 
            FROM portal_users 
            WHERE 
                (
                    LOWER(username) = LOWER($1)
                    OR LOWER(email)  = LOWER($2)
                    OR phone_number  = $3
                )
                AND is_deleted = FALSE
                AND user_type_id = $4
                AND buyer_id = $5
                AND portal_user_uuid != $6
            `,
            [usernameTrim, email.trim(), phone_number,user_type_id,buyer_id, portal_user_uuid]
        );

        if (duplicate.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Update failed",
                error: "Username, email, or phone number already exists"
            });
        }

        /* ======================================================
           UPDATE PORTAL USER
        ====================================================== */
        const update = await client.query(
            `
            UPDATE portal_users
            SET 
                username     = $1,
                full_name    = $2,
                email        = $3,
                phone_number = $4,
                user_type_id    = $5,
                buyer_id     = $6,
                modified_by  = $7,
                modified_at  = NOW(),
                is_active    = $8,
                profile_icon = $9
            WHERE portal_user_uuid = $10
            RETURNING *
            `,
            [
                usernameTrim,
                fullNameTrim,
                email.trim(),
                phone_number,
                user_type_id,
                buyer_id,
                modified_by,
                is_active,
                profile_icon || existingProfileIcon,
                portal_user_uuid
            ]
        );

        /* ======================================================
           AUTO-UNLOCK AFTER SUCCESS
        ====================================================== */
        await client.query(
            `
            UPDATE record_locks
            SET is_deleted = TRUE,
                deleted_by = $1,
                deleted_at = NOW()
            WHERE table_name = 'portal_users'
              AND record_id  = $2
              AND locked_by  = $3
              AND is_deleted = FALSE
            `,
            [modified_by, portal_user_uuid, modified_by]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Buyer portal user updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');

        logger.error("Responder Error (update portal users):", err);
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

// --------------------------------------------------
// DELETE BUYER PORTAL USER (SOFT DELETE)
// --------------------------------------------------

responder.on('delete-buyer-portal-users', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { portal_user_uuid } = req;
        const { deleted_by } = req.body;

        /* ======================================================
           VALIDATIONS
        ====================================================== */
        if (!portal_user_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Buyer portal user UUID is required"
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

        /* ======================================================
           CHECK IF USER EXISTS
        ====================================================== */
        const check = await client.query(
            `SELECT portal_user_id FROM portal_users
             WHERE portal_user_uuid = $1 AND is_deleted = FALSE`,
            [portal_user_uuid]
        );

        if (check.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Buyer portal user not found"
            });
        }

        /* ======================================================
           SOFT DELETE PORTAL USER
        ====================================================== */
        await client.query(
            `
            UPDATE portal_users
            SET 
                is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
            WHERE portal_user_uuid = $2
            `,
            [deleted_by, portal_user_uuid]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Buyer portal user deleted successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');

        logger.error("Responder Error (delete buyer portal users):", err);
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



// --------------------------------------------------
// UPDATE USER STATUS (ACTIVE / INACTIVE)
// --------------------------------------------------

responder.on('status-buyer-portal-users', async (req, cb) => {
    try {
        const portal_user_uuid = req.portal_user_uuid;
        const modified_by = req.body.modified_by;

        if (!portal_user_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Buyer portal user UUID is required"
            });
        }

        // --------------------------------------------------
        // CHECK USER
        // --------------------------------------------------
        const check = await pool.query(
            `
            SELECT portal_user_id, is_active 
            FROM portal_users 
            WHERE portal_user_uuid = $1 AND is_deleted = FALSE
            `,
            [portal_user_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "User not found",
                error: "No buyer portal user found with the provided UUID"
            });
        }

        const currentStatus = check.rows[0].is_active;
        const newStatus = !currentStatus; // Toggle active/inactive

        // --------------------------------------------------
        // UPDATE STATUS
        // --------------------------------------------------
        const result = await pool.query(
            `
            UPDATE portal_users
            SET 
                is_active = $1,
                modified_by = $2,
                modified_at = NOW()
            WHERE portal_user_uuid = $3
            `,
            [newStatus, modified_by, portal_user_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Update failed",
                error: "Username, email, or phone number already exists"
            });
        }

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: newStatus
                ? "Buyer portal user activated successfully"
                : "Buyer portal user deactivated successfully"
        });

    } catch (err) {
        logger.error("Responder Error (status user):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Update failed",
            error: err.message
        });
    }
});


// --------------------------------------------------
// UNLOCK RECORD
// --------------------------------------------------

responder.on(`unlock-buyer-portal-user`, async (req, cb) => {
    const client = await pool.connect();
    try {
        const { uuid } = req;
        const user_id = req.body?.user_id;

        if (!user_id) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "User ID required",
                error: "User ID missing"
            });
        }

        await client.query('BEGIN');

        // Delete lock only if same user owns it

        const result = await client.query(
            `
            DELETE FROM record_locks
            WHERE table_name = 'portal_users'
              AND record_id = $1
              AND locked_by = $2
              AND is_deleted = FALSE
            `,
            [uuid, user_id]
        );

        // No lock deleted → locked by another user OR already expired/unlocked
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

        // Success
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: `Buyer Portal user record unlocked successfully`,
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

// --------------------------------------------------
// APPROVE / REJECT BUYER PORTAL USER
// --------------------------------------------------

responder.on('approve-reject-buyer-portal-users', async (req, cb) => {
    try {
        const portal_user_uuid = req.portal_user_uuid;
        const { modified_by, action } = req.body;

        // --------------------------------------------------
        // VALIDATE INPUTS
        // --------------------------------------------------
        if (!portal_user_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Buyer portal user UUID is required"
            });
        }
        if (action === undefined || action === null) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Action is required (1 = Approve, 0 = Reject)"
            });
        }
        if (![0, 1].includes(Number(action))) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid action value. Use 1 to approve or 0 to reject"
            });
        }

        // --------------------------------------------------
        // CHECK USER & FETCH buyer_id
        // --------------------------------------------------
        const check = await pool.query(
            `SELECT portal_user_id, is_approved, buyer_id
             FROM portal_users
             WHERE portal_user_uuid = $1 AND is_deleted = FALSE`,
            [portal_user_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "User not found",
                error: "No buyer portal user found with the provided UUID"
            });
        }

        const { buyer_id } = check.rows[0];

        // --------------------------------------------------
        // VALIDATE buyer_id EXISTS
        // --------------------------------------------------
        if (!buyer_id) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "No buyer account linked to this portal user"
            });
        }

        // --------------------------------------------------
        // CHECK PHONE NUMBER VERIFIED IN buyer_accounts
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT phone_number_verified
             FROM buyer_accounts
             WHERE buyer_id = $1`,
            [buyer_id]
        );

        if (buyerCheck.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Buyer not found",
                error: "No buyer account found for this portal user"
            });
        }

        if (!buyerCheck.rows[0].phone_number_verified) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Buyer is not verified"
            });
        }

        // --------------------------------------------------
        // UPDATE APPROVAL STATUS
        // --------------------------------------------------
        const isApproved = Number(action);

        const result = await pool.query(
            `UPDATE portal_users
             SET
                is_approved = $1,
                modified_by = $2,
                modified_at = NOW()
             WHERE portal_user_uuid = $3`,
            [isApproved, modified_by, portal_user_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Update failed",
                error: "Failed to update approval status"
            });
        }

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: isApproved === 1
                ? "Buyer portal user approved successfully"
                : "Buyer portal user rejected successfully"
        });

    } catch (err) {
        logger.error("Responder Error (approve-reject buyer portal users):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Update failed",
            error: err.message
        });
    }
});