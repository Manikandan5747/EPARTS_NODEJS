require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// ----------------------------------------------------------------
// REDIS / COTE SETUP
// ----------------------------------------------------------------
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'portal-users responder',
    key: 'portal-users',
    redis: { host: redisHost, port: redisPort }
});

// ================================================================
// HELPER — Generate next portal user code  (prefix PUSR + 4 digits)
// Rule: code format PUSR0001, PUSR0002 …
// Validation code seed is PUSR0001 (req #12)
// ================================================================
async function generateNextPortalUserCode(client = pool) {
    const result = await client.query(
        `SELECT portal_user_code
         FROM portal_users
         WHERE portal_user_code IS NOT NULL
           AND is_deleted = FALSE
         ORDER BY (regexp_replace(portal_user_code, '\\D', '', 'g'))::int DESC
         LIMIT 1`
    );
    const lastCode = result.rows[0]?.portal_user_code || null;
    if (!lastCode) return 'PUSR0001';
    const match = lastCode.match(/\d+$/);
    const number = match ? parseInt(match[0], 10) : 0;
    return `PUSR${(number + 1).toString().padStart(4, '0')}`;
}

// ================================================================
// HELPER — Standard error response
// ================================================================
function errResp(code, message, error) {
    return {
        header_type: 'ERROR',
        message_visibility: true,
        status: false,
        code,
        message,
        error
    };
}

// ================================================================
// 3. AUTO-GENERATE PORTAL USER CODE
// ================================================================
responder.on('generate-portal-user-code', async (req, cb) => {
    try {
        const nextCode = await generateNextPortalUserCode();
        return cb(null, {
            header_type: 'SUCCESS',
            message_visibility: true,
            status: true,
            code: 1000,
            message: 'Next portal user code generated',
            data: { portal_user_code: nextCode }
        });
    } catch (err) {
        logger.error('Responder Error (generate-portal-user-code):', err);
        return cb(null, errResp(2004, err.message, err.message));
    }
});

// ================================================================
// 1. CREATE PORTAL USER
// Business rules:
//   • Validate required fields (username, full_name, password, user_type_id)
//   • validation code prefix PUSR0001 (#12)
//   • If seller_id present → same full_name + portal_user_code NOT allowed
//     within same seller (#13)
//   • If buyer_id present  → same full_name + portal_user_code NOT allowed
//     within same buyer (#14)
//   • Different buyers CAN have same full_name (#15)
// ================================================================
responder.on('create-portal-user', async (req, cb) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const {
            username,
            full_name,
            email,
            phone_number,
            password,
            user_type_id,
            seller_id,
            buyer_id,
            profile_icon,
            created_by
        } = req.body;

        // ----------------------------------------------------------
        // VALIDATION  (#12 — validation code PUSR0001)
        // ----------------------------------------------------------
        const validationErrors = [];
        if (!username?.trim())   validationErrors.push('Username is required');
        if (!full_name?.trim())  validationErrors.push('Full name is required');
        if (!password?.trim())   validationErrors.push('Password is required');
        if (!user_type_id)       validationErrors.push('User type is required');
        if (!seller_id && !buyer_id)
            validationErrors.push('Either seller_id or buyer_id is required');

        if (validationErrors.length > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                ...errResp(2001, 'Validation failed', validationErrors.join(', ')),
                validation_code: 'PUSR0001'
            });
        }

        const usernameTrim = username.trim();
        const fullNameTrim = full_name.trim();

        // ----------------------------------------------------------
        // DUPLICATE username check (global — username is unique key)
        // ----------------------------------------------------------
        const dupUsername = await client.query(
            `SELECT 1 FROM portal_users
             WHERE LOWER(username) = LOWER($1)
               AND is_deleted = FALSE`,
            [usernameTrim]
        );
        if (dupUsername.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, errResp(2002, 'Creation failed', 'Username already exists'));
        }

        // ----------------------------------------------------------
        // DUPLICATE email check (global — email is unique key)
        // ----------------------------------------------------------
        if (email) {
            const dupEmail = await client.query(
                `SELECT 1 FROM portal_users
                 WHERE LOWER(email) = LOWER($1)
                   AND is_deleted = FALSE`,
                [email.trim()]
            );
            if (dupEmail.rowCount > 0) {
                await client.query('ROLLBACK');
                return cb(null, errResp(2002, 'Creation failed', 'Email already exists'));
            }
        }

        // ----------------------------------------------------------
        // RULE #13 — same seller cannot have same full_name + code
        // (code is auto-generated, so we check full_name uniqueness
        //  within the same seller)
        // ----------------------------------------------------------
        if (seller_id) {
            const dupSeller = await client.query(
                `SELECT 1 FROM portal_users
                 WHERE seller_id = $1
                   AND LOWER(full_name) = LOWER($2)
                   AND is_deleted = FALSE`,
                [seller_id, fullNameTrim]
            );
            if (dupSeller.rowCount > 0) {
                await client.query('ROLLBACK');
                return cb(null, errResp(2002, 'Creation failed',
                    'A portal user with the same name already exists under this seller'));
            }
        }

        // ----------------------------------------------------------
        // RULE #14 — same buyer cannot have same full_name + code
        // (#15 — different buyers CAN share the same full_name, so
        //         the check is scoped to buyer_id only)
        // ----------------------------------------------------------
        if (buyer_id) {
            const dupBuyer = await client.query(
                `SELECT 1 FROM portal_users
                 WHERE buyer_id = $1
                   AND LOWER(full_name) = LOWER($2)
                   AND is_deleted = FALSE`,
                [buyer_id, fullNameTrim]
            );
            if (dupBuyer.rowCount > 0) {
                await client.query('ROLLBACK');
                return cb(null, errResp(2002, 'Creation failed',
                    'A portal user with the same name already exists under this buyer'));
            }
        }

        // ----------------------------------------------------------
        // AUTO-GENERATE CODE (#3 / #12)
        // ----------------------------------------------------------
        const portal_user_code = await generateNextPortalUserCode(client);

        // ----------------------------------------------------------
        // HASH PASSWORD
        // ----------------------------------------------------------
        const bcrypt = require('bcryptjs');
        const password_hash = await bcrypt.hash(password, 10);

        // ----------------------------------------------------------
        // INSERT
        // ----------------------------------------------------------
        const insert = await client.query(
            `INSERT INTO portal_users
                (portal_user_code, username, full_name, email, phone_number,
                 password_hash, user_type_id, seller_id, buyer_id,
                 profile_icon, is_active, is_approved,
                 created_by, created_at)
             VALUES
                ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,false,$11,NOW())
             RETURNING
                portal_user_id, portal_user_uuid, portal_user_code,
                username, full_name, email, phone_number,
                user_type_id, seller_id, buyer_id, is_active, is_approved`,
            [
                portal_user_code, usernameTrim, fullNameTrim,
                email || null, phone_number || null, password_hash,
                user_type_id, seller_id || null, buyer_id || null,
                profile_icon || null, created_by || null
            ]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: 'SUCCESS',
            message_visibility: true,
            status: true,
            code: 1000,
            message: 'Portal user created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('Responder Error (create-portal-user):', err);
        return cb(null, errResp(2004, err.message, err.message));
    } finally {
        client.release();
    }
});

// ================================================================
// 2. UPDATE PORTAL USER
// Same duplicate rules as create apply on update (#13 / #14 / #15)
// ================================================================
responder.on('update-portal-user', async (req, cb) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const portal_user_uuid = req.portal_user_uuid;
        const {
            username,
            full_name,
            email,
            phone_number,
            password,
            user_type_id,
            seller_id,
            buyer_id,
            profile_icon,
            modified_by
        } = req.body;

        if (!portal_user_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                ...errResp(2001, 'Validation failed', 'Portal user UUID is required'),
                validation_code: 'PUSR0001'
            });
        }
        if (!username?.trim() || !full_name?.trim()) {
            await client.query('ROLLBACK');
            return cb(null, {
                ...errResp(2001, 'Validation failed', 'Username and full name are required'),
                validation_code: 'PUSR0001'
            });
        }

        const usernameTrim = username.trim();
        const fullNameTrim = full_name.trim();

        // Fetch existing record
        const exists = await client.query(
            `SELECT portal_user_id, password_hash, profile_icon,
                    seller_id, buyer_id, portal_user_code
             FROM portal_users
             WHERE portal_user_uuid = $1 AND is_deleted = FALSE`,
            [portal_user_uuid]
        );
        if (exists.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, errResp(2003, 'Record not found', 'Portal user not found'));
        }

        const existing = exists.rows[0];
        const effectiveSellerId = seller_id ?? existing.seller_id;
        const effectiveBuyerId  = buyer_id  ?? existing.buyer_id;

        // Duplicate username check (excluding self)
        const dupUsername = await client.query(
            `SELECT 1 FROM portal_users
             WHERE LOWER(username) = LOWER($1)
               AND portal_user_uuid != $2
               AND is_deleted = FALSE`,
            [usernameTrim, portal_user_uuid]
        );
        if (dupUsername.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, errResp(2002, 'Update failed', 'Username already exists'));
        }

        // Duplicate email check (excluding self)
        if (email) {
            const dupEmail = await client.query(
                `SELECT 1 FROM portal_users
                 WHERE LOWER(email) = LOWER($1)
                   AND portal_user_uuid != $2
                   AND is_deleted = FALSE`,
                [email.trim(), portal_user_uuid]
            );
            if (dupEmail.rowCount > 0) {
                await client.query('ROLLBACK');
                return cb(null, errResp(2002, 'Update failed', 'Email already exists'));
            }
        }

        // Rule #13 — seller scope full_name uniqueness (excluding self)
        if (effectiveSellerId) {
            const dupSeller = await client.query(
                `SELECT 1 FROM portal_users
                 WHERE seller_id = $1
                   AND LOWER(full_name) = LOWER($2)
                   AND portal_user_uuid != $3
                   AND is_deleted = FALSE`,
                [effectiveSellerId, fullNameTrim, portal_user_uuid]
            );
            if (dupSeller.rowCount > 0) {
                await client.query('ROLLBACK');
                return cb(null, errResp(2002, 'Update failed',
                    'A portal user with the same name already exists under this seller'));
            }
        }

        // Rule #14 — buyer scope full_name uniqueness (excluding self)
        if (effectiveBuyerId) {
            const dupBuyer = await client.query(
                `SELECT 1 FROM portal_users
                 WHERE buyer_id = $1
                   AND LOWER(full_name) = LOWER($2)
                   AND portal_user_uuid != $3
                   AND is_deleted = FALSE`,
                [effectiveBuyerId, fullNameTrim, portal_user_uuid]
            );
            if (dupBuyer.rowCount > 0) {
                await client.query('ROLLBACK');
                return cb(null, errResp(2002, 'Update failed',
                    'A portal user with the same name already exists under this buyer'));
            }
        }

        // Hash new password only if provided
        const bcrypt = require('bcryptjs');
        const password_hash = password
            ? await bcrypt.hash(password, 10)
            : existing.password_hash;

        const update = await client.query(
            `UPDATE portal_users
             SET
                username     = $1,
                full_name    = $2,
                email        = COALESCE($3, email),
                phone_number = COALESCE($4, phone_number),
                password_hash= $5,
                user_type_id = COALESCE($6, user_type_id),
                seller_id    = COALESCE($7, seller_id),
                buyer_id     = COALESCE($8, buyer_id),
                profile_icon = COALESCE($9, profile_icon),
                modified_by  = $10,
                modified_at  = NOW()
             WHERE portal_user_uuid = $11
             RETURNING
                portal_user_id, portal_user_uuid, portal_user_code,
                username, full_name, email, phone_number,
                user_type_id, seller_id, buyer_id, is_active, is_approved`,
            [
                usernameTrim, fullNameTrim,
                email || null, phone_number || null,
                password_hash,
                user_type_id || null,
                seller_id || null, buyer_id || null,
                profile_icon || null,
                modified_by || null,
                portal_user_uuid
            ]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: 'SUCCESS',
            message_visibility: true,
            status: true,
            code: 1000,
            message: 'Portal user updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('Responder Error (update-portal-user):', err);
        return cb(null, errResp(2004, err.message, err.message));
    } finally {
        client.release();
    }
});

// ================================================================
// 4. LIST PORTAL USERS (simple, scoped by seller_id or buyer_id)
// ================================================================
responder.on('list-portal-users', async (req, cb) => {
    try {
        const { seller_id, buyer_id } = req.query || {};

        let whereClause = 'pu.is_deleted = FALSE AND pu.is_active = TRUE';
        const params = [];

        if (seller_id) {
            params.push(seller_id);
            whereClause += ` AND pu.seller_id = $${params.length}`;
        }
        if (buyer_id) {
            params.push(buyer_id);
            whereClause += ` AND pu.buyer_id = $${params.length}`;
        }

        const result = await pool.query(
            `SELECT
                pu.portal_user_id,
                pu.portal_user_uuid,
                pu.portal_user_code,
                pu.username,
                pu.full_name,
                pu.email,
                pu.phone_number,
                pu.user_type_id,
                pu.seller_id,
                pu.buyer_id,
                pu.profile_icon,
                pu.is_online,
                pu.is_approved,
                pu.is_active,
                pu.last_login,
                pu.created_at,
                pu.created_by,
                pu.modified_at,
                pu.modified_by
             FROM portal_users pu
             WHERE ${whereClause}
             ORDER BY pu.created_at ASC`,
            params
        );

        return cb(null, {
            header_type: 'SUCCESS',
            message_visibility: true,
            status: true,
            code: 1000,
            message: 'Portal users list fetched successfully',
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (list-portal-users):', err);
        return cb(null, errResp(2004, err.message, err.message));
    }
});

// ================================================================
// 5. FIND PORTAL USER (search by keyword — name / username / code)
// ================================================================
responder.on('find-portal-user', async (req, cb) => {
    try {
        const { search, seller_id, buyer_id } = req.body;

        if (!search?.trim()) {
            return cb(null, errResp(2001, 'Validation failed', 'Search keyword is required'));
        }

        const keyword = `%${search.trim()}%`;
        const params = [keyword];

        let scopeWhere = '';
        if (seller_id) {
            params.push(seller_id);
            scopeWhere += ` AND pu.seller_id = $${params.length}`;
        }
        if (buyer_id) {
            params.push(buyer_id);
            scopeWhere += ` AND pu.buyer_id = $${params.length}`;
        }

        const result = await pool.query(
            `SELECT
                pu.portal_user_id,
                pu.portal_user_uuid,
                pu.portal_user_code,
                pu.username,
                pu.full_name,
                pu.email,
                pu.phone_number,
                pu.user_type_id,
                pu.seller_id,
                pu.buyer_id,
                pu.is_active,
                pu.is_approved
             FROM portal_users pu
             WHERE pu.is_deleted = FALSE
               AND (
                   pu.full_name ILIKE $1
                   OR pu.username ILIKE $1
                   OR pu.portal_user_code ILIKE $1
                   OR pu.email ILIKE $1
               )
               ${scopeWhere}
             ORDER BY pu.created_at ASC`,
            params
        );

        return cb(null, {
            header_type: 'SUCCESS',
            message_visibility: true,
            status: true,
            code: 1000,
            message: 'Portal user search result',
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (find-portal-user):', err);
        return cb(null, errResp(2004, err.message, err.message));
    }
});

// ================================================================
// 6. FIND BY ID (portal_user_uuid)
// ================================================================
responder.on('findbyid-portal-user', async (req, cb) => {
    try {
        const portal_user_uuid = req.portal_user_uuid;

        if (!portal_user_uuid) {
            return cb(null, errResp(2001, 'Validation failed', 'Portal user UUID is required'));
        }

        const result = await pool.query(
            `SELECT
                pu.portal_user_id,
                pu.portal_user_uuid,
                pu.portal_user_code,
                pu.username,
                pu.full_name,
                pu.email,
                pu.phone_number,
                pu.user_type_id,
                pu.seller_id,
                pu.buyer_id,
                pu.profile_icon,
                pu.is_online,
                pu.force_logout,
                pu.last_login,
                pu.is_approved,
                pu.is_active,
                pu.assigned_to,
                pu.assigned_at,
                pu.created_at,
                pu.created_by,
                pu.modified_at,
                pu.modified_by
             FROM portal_users pu
             WHERE pu.portal_user_uuid = $1
               AND pu.is_deleted = FALSE`,
            [portal_user_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, errResp(2003, 'Record not found', 'Portal user not found'));
        }

        return cb(null, {
            header_type: 'SUCCESS',
            message_visibility: true,
            status: true,
            code: 1000,
            message: 'Portal user fetched successfully',
            data: result.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (findbyid-portal-user):', err);
        return cb(null, errResp(2004, err.message, err.message));
    }
});

// ================================================================
// 7 & 8. ADVANCED FILTER + PAGINATION  (combined)
// Supports: page, limit, search, sort, seller_id, buyer_id filters
// ================================================================
responder.on('advancefilter-portal-users', async (req, cb) => {
    try {
        const { seller_id, buyer_id } = req.body;

        let extraWhere = '';
        const extraParams = [];

        if (seller_id) {
            extraParams.push(seller_id);
            extraWhere += ` AND PU.seller_id = $extraSeller`;
        }
        if (buyer_id) {
            extraParams.push(buyer_id);
            extraWhere += ` AND PU.buyer_id = $extraBuyer`;
        }

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            table: 'portal_users',
            alias: 'PU',
            defaultSort: 'created_at',

            joinSql: `
                LEFT JOIN seller_accounts SA ON PU.seller_id = SA.seller_id
                LEFT JOIN buyer_accounts  BA ON PU.buyer_id  = BA.buyer_id
            `,

            allowedFields: [
                'username', 'full_name', 'email', 'phone_number',
                'portal_user_code', 'user_type_id',
                'seller_id', 'buyer_id',
                'is_active', 'is_approved',
                'created_at', 'modified_at',
                'seller_name', 'buyer_name'
            ],

            customFields: {
                seller_name: {
                    select: 'SA.seller_name',
                    search: 'SA.seller_name',
                    sort:   'SA.seller_name'
                },
                buyer_name: {
                    select: 'BA.buyer_name',
                    search: 'BA.buyer_name',
                    sort:   'BA.buyer_name'
                }
            },

            baseWhere: `PU.is_deleted = FALSE ${extraWhere}`,
            baseParams: extraParams
        });

        return cb(null, {
            header_type: 'SUCCESS',
            message_visibility: true,
            status: true,
            code: 1000,
            message: 'Portal users fetched successfully',
            error: null,
            result
        });

    } catch (err) {
        logger.error('Responder Error (advancefilter-portal-users):', err);
        return cb(null, errResp(2004, err.message, err.message));
    }
});

// ================================================================
// 9. UPDATE STATUS (toggle active / inactive)
// ================================================================
responder.on('status-portal-user', async (req, cb) => {
    try {
        const portal_user_uuid = req.portal_user_uuid;
        const modified_by = req.body.modified_by;

        if (!portal_user_uuid) {
            return cb(null, errResp(2001, 'Validation failed', 'Portal user UUID is required'));
        }

        const check = await pool.query(
            `SELECT portal_user_id, is_active
             FROM portal_users
             WHERE portal_user_uuid = $1 AND is_deleted = FALSE`,
            [portal_user_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, errResp(2003, 'Record not found', 'Portal user not found'));
        }

        const newStatus = !check.rows[0].is_active;

        await pool.query(
            `UPDATE portal_users
             SET is_active   = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE portal_user_uuid = $3`,
            [newStatus, modified_by || null, portal_user_uuid]
        );

        return cb(null, {
            header_type: 'SUCCESS',
            message_visibility: true,
            status: true,
            code: 1000,
            message: newStatus ? 'Portal user activated successfully' : 'Portal user deactivated successfully'
        });

    } catch (err) {
        logger.error('Responder Error (status-portal-user):', err);
        return cb(null, errResp(2004, err.message, err.message));
    }
});

// ================================================================
// 10. DELETE PORTAL USER (soft delete)
// ================================================================
responder.on('delete-portal-user', async (req, cb) => {
    try {
        const portal_user_uuid = req.portal_user_uuid;
        const deleted_by = req.body.deleted_by;

        if (!portal_user_uuid) {
            return cb(null, errResp(2001, 'Validation failed', 'Portal user UUID is required'));
        }

        const check = await pool.query(
            `SELECT 1 FROM portal_users
             WHERE portal_user_uuid = $1 AND is_deleted = FALSE`,
            [portal_user_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, errResp(2003, 'Record not found', 'Portal user not found'));
        }

        await pool.query(
            `UPDATE portal_users
             SET is_deleted  = TRUE,
                 is_active   = FALSE,
                 deleted_by  = $1,
                 deleted_at  = NOW()
             WHERE portal_user_uuid = $2`,
            [deleted_by || null, portal_user_uuid]
        );

        return cb(null, {
            header_type: 'SUCCESS',
            message_visibility: true,
            status: true,
            code: 1000,
            message: 'Portal user deleted successfully'
        });

    } catch (err) {
        logger.error('Responder Error (delete-portal-user):', err);
        return cb(null, errResp(2004, err.message, err.message));
    }
});

// ================================================================
// 11. APPROVE PORTAL USER (toggle is_approved)
// ================================================================
responder.on('approve-portal-user', async (req, cb) => {
    try {
        const portal_user_uuid = req.portal_user_uuid;
        const { approved_by, is_approved } = req.body;

        if (!portal_user_uuid) {
            return cb(null, errResp(2001, 'Validation failed', 'Portal user UUID is required'));
        }

        const check = await pool.query(
            `SELECT portal_user_id, is_approved
             FROM portal_users
             WHERE portal_user_uuid = $1 AND is_deleted = FALSE`,
            [portal_user_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, errResp(2003, 'Record not found', 'Portal user not found'));
        }

        // Accept explicit value, otherwise toggle
        const newApproved = (is_approved !== undefined && is_approved !== null)
            ? Boolean(is_approved)
            : !check.rows[0].is_approved;

        await pool.query(
            `UPDATE portal_users
             SET is_approved = $1,
                 modified_by = $2,
                 modified_at = NOW()
             WHERE portal_user_uuid = $3`,
            [newApproved, approved_by || null, portal_user_uuid]
        );

        return cb(null, {
            header_type: 'SUCCESS',
            message_visibility: true,
            status: true,
            code: 1000,
            message: newApproved
                ? 'Portal user approved successfully'
                : 'Portal user approval revoked successfully',
            data: { is_approved: newApproved }
        });

    } catch (err) {
        logger.error('Responder Error (approve-portal-user):', err);
        return cb(null, errResp(2004, err.message, err.message));
    }
});

// ================================================================
// 16. ADMIN — TOTAL LIST OF ALL PORTAL USERS (across all sellers/buyers)
// ================================================================
responder.on('admin-list-all-portal-users', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT
                pu.portal_user_id,
                pu.portal_user_uuid,
                pu.portal_user_code,
                pu.username,
                pu.full_name,
                pu.email,
                pu.phone_number,
                pu.user_type_id,
                pu.seller_id,
                pu.buyer_id,
                pu.is_online,
                pu.is_approved,
                pu.is_active,
                pu.last_login,
                pu.created_at,
                pu.modified_at,
                -- Seller / Buyer display names
                SA.seller_name,
                BA.buyer_name
             FROM portal_users pu
             LEFT JOIN seller_accounts SA ON pu.seller_id = SA.seller_id
             LEFT JOIN buyer_accounts  BA ON pu.buyer_id  = BA.buyer_id
             WHERE pu.is_deleted = FALSE
             ORDER BY pu.created_at ASC`
        );

        return cb(null, {
            header_type: 'SUCCESS',
            message_visibility: true,
            status: true,
            code: 1000,
            message: 'All portal users fetched successfully',
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (admin-list-all-portal-users):', err);
        return cb(null, errResp(2004, err.message, err.message));
    }
});
