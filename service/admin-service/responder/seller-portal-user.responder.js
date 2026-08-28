require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const commonenum = require('@libs/config/enum');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'seller-portal-user responder',
    key: 'seller-portal-user',
    redis: { host: redisHost, port: redisPort }
});

// ================================================================
// Generate next user code
// ================================================================

async function generateNextSellerUserCode(pool) {
    // --------------------------------------------------
    // FETCH PREFIX
    // --------------------------------------------------
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM prefix_refno
         WHERE table_name = 'portal_users' 
         AND category_type = 'SELLER_PORTAL_USERS' 
         AND is_active = true 
         AND is_deleted = false
         ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = prefixRes.rows[0]?.prefix_code || "SPU";

    // --------------------------------------------------
    // FETCH LAST CODE FILTERED BY SELLER USER TYPE
    // --------------------------------------------------
    const result = await pool.query(
        `SELECT portal_user_code FROM portal_users
         WHERE portal_user_code IS NOT NULL
         AND user_type_id = $1
         ORDER BY (regexp_replace(portal_user_code, '\\D', '', 'g'))::int DESC
         LIMIT 1`,
        [commonenum.USER_TYPE_ID.SELLER]
    );

    const lastCode = result.rows[0]?.portal_user_code || null;
    if (!lastCode) return `${prefix}00001`;

    const match = lastCode.match(/\d+$/);
    const number = match ? parseInt(match[0], 10) : 0;
    return `${prefix}${(number + 1).toString().padStart(5, "0")}`;
}

// --------------------------------------------------
// CREATE SELLER PORTAL USER
// --------------------------------------------------

responder.on("create-seller-portal-users", async (req, cb) => {
    try {
        const {
            username,
            full_name,
            email,
            phone_number,
            password,
            seller_uuid,
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
        
        if (!seller_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Seller UUID is required"
            });
        }

        const usernameTrim = username.trim();

        // -----------------------------
        // USER TYPE ID FROM ENUM
        // -----------------------------
        const user_type_id = commonenum.USER_TYPE_ID.SELLER;

        // -----------------------------
        // FETCH seller_id
        // -----------------------------

        let seller_id = null;
        if (seller_uuid) {
            const sellerResult = await pool.query(
                `SELECT seller_id FROM seller_accounts
                 WHERE seller_uuid = $1
                 AND is_deleted = FALSE
                 AND is_active = TRUE`,
                [seller_uuid]
            );
            if (sellerResult.rowCount === 0) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Invalid Seller UUID"
                });
            }
            seller_id = sellerResult.rows[0].seller_id;
        }

        // -----------------------------
        // DUPLICATE CHECK
        // -----------------------------
        const duplicateCheck = await pool.query(
            `SELECT portal_user_id FROM portal_users 
             WHERE (username = $1 OR email = $2 OR phone_number = $3)
             AND user_type_id = $4
             AND seller_id = $5
             AND is_deleted = FALSE`,
            [usernameTrim, email, phone_number, user_type_id, seller_id]
        );

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
        const portal_user_code = await generateNextSellerUserCode(pool);

        // --------------------------------------------------
        // HASH PASSWORD
        // --------------------------------------------------
        const password_hash = await bcrypt.hash(password, 10);

        // -----------------------------
        // INSERT USER
        // -----------------------------
        const insert = await pool.query(
            `INSERT INTO portal_users 
                (username, full_name, email, phone_number,
                 password_hash, user_type_id, seller_id, created_by, assigned_to, portal_user_code, profile_icon)
             VALUES 
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING 
                portal_user_id, portal_user_uuid, portal_user_code, username, full_name, email, 
                phone_number, user_type_id, seller_id, is_active, profile_icon`,
            [
                usernameTrim,
                full_name,
                email,
                phone_number,
                password_hash,
                user_type_id,
                seller_id,
                created_by,
                created_by,
                portal_user_code,
                profile_icon
            ]
        );

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Seller portal user created successfully",
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (create-seller-portal-users):", err);
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
// LIST SELLER PORTAL USERS
// --------------------------------------------------

responder.on('list-seller-portal-users', async (req, cb) => {
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
                pu.seller_id,
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

                -- Seller Account Owner Username
                sa.user_id AS seller_user_id,
                seller_owner.username AS sellerUsername

            FROM portal_users pu

            LEFT JOIN users creator 
                ON pu.created_by = creator.user_uuid

            LEFT JOIN users updater 
                ON pu.modified_by = updater.user_uuid

            LEFT JOIN user_types ut
                ON pu.user_type_id = ut.user_type_id

            LEFT JOIN seller_accounts sa
                ON pu.seller_id = sa.seller_id

            LEFT JOIN users seller_owner
                ON sa.user_id = seller_owner.user_id

            WHERE 
                pu.is_deleted = FALSE
                AND pu.seller_id IS NOT NULL

            ORDER BY 
                pu.created_at ASC
        `;

        const result = await pool.query(query);

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Seller portal users list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("Responder Error (list seller portal users):", err);
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

responder.on('getById-seller-portal-users', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { portal_user_uuid } = req;
        const mode = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

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

        const result = await client.query(
            `SELECT 
                u.portal_user_id,
                u.portal_user_uuid,
                u.username,
                u.full_name,
                u.email,
                u.phone_number,
                u.user_type_id,
                u.seller_id,
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

                creators.username AS created_by_name,
                updaters.username AS updated_by_name,
                ut.name AS user_type_name

            FROM portal_users u
            LEFT JOIN users creators ON u.created_by = creators.user_uuid
            LEFT JOIN users updaters ON u.modified_by = updaters.user_uuid
            LEFT JOIN user_types ut ON u.user_type_id = ut.user_type_id

            WHERE 
                u.portal_user_uuid = $1
                AND u.is_deleted = FALSE
                AND u.seller_id IS NOT NULL`,
            [portal_user_uuid]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Seller portal user not found"
            });
        }

        const portalUser = result.rows[0];
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
            const isExpired = lockRow && new Date(lockRow.expires_at).getTime() < Date.now();

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
                     SET is_deleted = TRUE, deleted_by = $1, deleted_at = NOW()
                     WHERE lock_id = $2`,
                    [user_id, lockRow.lock_id]
                );
                lockRow = null;
            }

            if (!lockRow) {
                const newLock = await client.query(
                    `INSERT INTO record_locks(table_name, record_id, locked_by, expires_at, created_by)
                     VALUES('portal_users', $1, $2, NOW() + ($3 || ' minute')::INTERVAL, $2)
                     RETURNING *`,
                    [portal_user_uuid, user_id, LOCK_MINUTES]
                );
                lockRow = newLock.rows[0];
            } else if (lockRow.locked_by === user_id) {
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

        portalUser.lock_status =
            lockRow && new Date(lockRow.expires_at).getTime() >= Date.now();

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Seller portal user fetched successfully",
            data: portalUser,
            lock: lockRow
                ? {
                    status: portalUser.lock_status,
                    by: lockRow.locked_by,
                    by_name: lockRow.locked_by_name,
                    expires_at: lockRow.expires_at
                }
                : { status: false }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (getById seller portal users):", err);
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
// UPDATE SELLER PORTAL USER
// --------------------------------------------------

responder.on('update-seller-portal-users', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { portal_user_uuid } = req;
        const {
            username,
            full_name,
            email,
            phone_number,
            seller_uuid,
            modified_by,
            is_active,
            profile_icon
        } = req.body;

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
        const user_type_id = commonenum.USER_TYPE_ID.SELLER;

        // -----------------------------
        // FETCH seller_id
        // -----------------------------

        let seller_id = null;
        if (seller_uuid) {
            const sellerResult = await pool.query(
                `SELECT seller_id FROM seller_accounts
                 WHERE seller_uuid = $1
                 AND is_deleted = FALSE
                 AND is_active = TRUE`,
                [seller_uuid]
            );
            if (sellerResult.rowCount === 0) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Invalid Seller UUID"
                });
            }
            seller_id = sellerResult.rows[0].seller_id;
        }


        const usernameTrim = username.trim();
        const fullNameTrim = full_name.trim();

        // --------------------------------------------------
        // CHECK EDIT LOCK
        // --------------------------------------------------
        const lockCheck = await client.query(
            `SELECT 1 FROM record_locks
             WHERE table_name = 'portal_users'
               AND record_id = $1
               AND locked_by = $2
               AND is_deleted = FALSE
               AND expires_at > NOW()`,
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

        // --------------------------------------------------
        // CHECK USER EXISTS
        // --------------------------------------------------
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
                error: "Seller portal user not found"
            });
        }

        const existingProfileIcon = exists.rows[0].profile_icon;

        // --------------------------------------------------
        // DUPLICATE CHECK
        // --------------------------------------------------
        const duplicate = await client.query(
            `SELECT portal_user_id FROM portal_users 
             WHERE (
                LOWER(username) = LOWER($1)
                OR LOWER(email) = LOWER($2)
                OR phone_number = $3
             )
             AND is_deleted = FALSE
             AND user_type_id = $4
             AND seller_id = $5
             AND portal_user_uuid != $6`,
            [usernameTrim, email.trim(), phone_number,user_type_id, seller_id,portal_user_uuid]
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

        // --------------------------------------------------
        // UPDATE USER
        // --------------------------------------------------
        const update = await client.query(
            `UPDATE portal_users
             SET 
                username     = $1,
                full_name    = $2,
                email        = $3,
                phone_number = $4,
                user_type_id    = $5,
                seller_id    = $6,
                modified_by  = $7,
                modified_at  = NOW(),
                is_active    = $8,
                profile_icon = $9
             WHERE portal_user_uuid = $10
             RETURNING *`,
            [
                usernameTrim,
                fullNameTrim,
                email.trim(),
                phone_number,
                user_type_id,
                seller_id,
                modified_by,
                is_active,
                profile_icon || existingProfileIcon,
                portal_user_uuid
            ]
        );

        // --------------------------------------------------
        // AUTO-UNLOCK AFTER SUCCESS
        // --------------------------------------------------
        await client.query(
            `UPDATE record_locks
             SET is_deleted = TRUE, deleted_by = $1, deleted_at = NOW()
             WHERE table_name = 'portal_users'
               AND record_id = $2
               AND locked_by = $3
               AND is_deleted = FALSE`,
            [modified_by, portal_user_uuid, modified_by]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Seller portal user updated successfully",
            data: update.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (update seller portal users):", err);
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
// DELETE SELLER PORTAL USER (SOFT DELETE)
// --------------------------------------------------

responder.on('delete-seller-portal-users', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { portal_user_uuid } = req;
        const { deleted_by } = req.body;

        if (!portal_user_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Seller portal user UUID is required"
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
                error: "Seller portal user not found"
            });
        }

        await client.query(
            `UPDATE portal_users
             SET 
                is_deleted = TRUE,
                is_active  = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
             WHERE portal_user_uuid = $2`,
            [deleted_by, portal_user_uuid]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Seller portal user deleted successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (delete seller portal users):", err);
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

responder.on('status-seller-portal-users', async (req, cb) => {
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
                error: "Seller portal user UUID is required"
            });
        }

        const check = await pool.query(
            `SELECT portal_user_id, is_active 
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
                error: "No seller portal user found with the provided UUID"
            });
        }

        const currentStatus = check.rows[0].is_active;
        const newStatus = !currentStatus;

        const result = await pool.query(
            `UPDATE portal_users
             SET 
                is_active   = $1,
                modified_by = $2,
                modified_at = NOW()
             WHERE portal_user_uuid = $3`,
            [newStatus, modified_by, portal_user_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Update failed",
                error: "Failed to update status"
            });
        }

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: newStatus
                ? "Seller portal user activated successfully"
                : "Seller portal user deactivated successfully"
        });

    } catch (err) {
        logger.error("Responder Error (status seller portal users):", err);
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
// ADVANCED FILTER —  PORTAL USERS
// --------------------------------------------------

responder.on('advancefilter-portal-users', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        let extraWhere = '';
        let extraParams = [];

        if (accessScope && accessScope.type === 'PRIVATE') {
            extraWhere = ' AND PU.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            table: 'portal_users',
            alias: 'PU',
            defaultSort: 'created_at',

            joinSql: `
                LEFT JOIN users creators ON PU.created_by = creators.user_uuid
                LEFT JOIN users updaters ON PU.modified_by = updaters.user_uuid
                LEFT JOIN user_types ut ON PU.user_type_id = ut.user_type_id
                LEFT JOIN seller_accounts sa ON PU.seller_id = sa.seller_id
                LEFT JOIN buyer_accounts ba ON PU.buyer_id = ba.buyer_id
            `,

            allowedFields: [
                'username', 'full_name', 'email', 'phone_number',
                'user_type_name', 'seller_id','buyer_id',
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
                },
                user_type_name: {
                    select: 'ut.name',
                    search: 'ut.name',
                    sort: 'ut.name'
                },
                seller_id: {
                    select: 'sa.seller_id',
                    search: 'sa.seller_id',
                    sort: 'sa.seller_id'
                },
                buyer_id: {
                    select: 'ba.buyer_id',
                    search: 'ba.buyer_id',
                    sort: 'ba.buyer_id'
                }
            },

            baseWhere: `PU.is_deleted = FALSE ${extraWhere}`,
            baseParams: extraParams
        });

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Portal users fetched successfully",
            result
        });

    } catch (err) {
        logger.error('[advancefilter-portal-users] error:', err);
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

// --------------------------------------------------
// UNLOCK RECORD
// --------------------------------------------------

responder.on('unlock-seller-portal-user', async (req, cb) => {
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

        const result = await client.query(
            `DELETE FROM record_locks
             WHERE table_name = 'portal_users'
               AND record_id = $1
               AND locked_by = $2
               AND is_deleted = FALSE`,
            [uuid, user_id]
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
            message: "Seller portal user record unlocked successfully"
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
// APPROVE / REJECT SELLER PORTAL USER
// --------------------------------------------------

responder.on('approve-reject-seller-portal-users', async (req, cb) => {
    try {
        const portal_user_uuid = req.portal_user_uuid;
        const { modified_by, action } = req.body;

        if (!portal_user_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Seller portal user UUID is required"
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

        // Check portal user exists and fetch seller_id
        const check = await pool.query(
            `SELECT portal_user_id, is_approved, seller_id
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
                error: "No seller portal user found with the provided UUID"
            });
        }

        const { seller_id } = check.rows[0];

        // Validate seller phone number verification
        if (!seller_id) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "No seller account linked to this portal user"
            });
        }

        const sellerCheck = await pool.query(
            `SELECT phone_number_verified
             FROM seller_accounts
             WHERE seller_id = $1`,
            [seller_id]
        );

        if (sellerCheck.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Seller not found",
                error: "No seller account found for this portal user"
            });
        }

        if (!sellerCheck.rows[0].phone_number_verified) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Seller is not verified"
            });
        }

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
                ? "Seller portal user approved successfully"
                : "Seller portal user rejected successfully"
        });

    } catch (err) {
        logger.error("Responder Error (approve-reject seller portal users):", err);
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