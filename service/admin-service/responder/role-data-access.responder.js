require('module-alias/register');

const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { v4: uuidv4 } = require("uuid");

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'role_data_access responder',
    key: 'role_data_access',
    redis: { host: redisHost, port: redisPort }
});



// ===================================================
// BULK CREATE | UPDATE ROLE DATA ACCESS
// ===================================================
responder.on("create-update-role-data-access", async (req, cb) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const { dept_id, cmp_id,
            created_by, hierarchy_level, assigned_to, data, profile_data
        } = req.body;
        const role_name = req.body?.role_name?.trim() || null;

        if (!role_name) {
            return cb(null, { status: false, code: 2001, error: "Role name is required" });
        }

        if (!Array.isArray(data) || data.length === 0) {
            return cb(null, { status: false, code: 2001, error: "Data array is required" });
        }

        if (!Array.isArray(profile_data) || profile_data.length === 0) {
            return cb(null, { status: false, code: 2001, error: "Profile array is required" });
        }

        const roleUpper = role_name.toUpperCase();
        const roleLower = role_name.toLowerCase();

        // --------------------------------------------------
        // CHECK FOR DUPLICATE ROLE NAME (Corrected table + columns)
        // --------------------------------------------------
        const checkQuery = {
            text: `
                    SELECT role_id FROM user_role 
                    WHERE (
                        UPPER(role_name) = $1 
                        OR LOWER(role_name) = $2 
                        OR role_name = $3
                    ) AND is_deleted = FALSE
                `,
            values: [roleUpper, roleLower, role_name]
        };

        const check = await pool.query(checkQuery);

        // CHECK FOR DUPLICATE
        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: "Role name already exists" });
        }


        // --------------------------------------------------
        // INSERT NEW ROLE (UUID auto-generated)
        // --------------------------------------------------
        const insert = await pool.query(
            `INSERT INTO user_role 
                    (role_name, dept_id, cmp_id,hierarchy_level, created_by,assigned_to)
                VALUES ($1, $2, $3, $4,$5,$6)`,
            [role_name, dept_id, cmp_id, hierarchy_level, created_by, assigned_to]
        );

        const role_id = insert.rows[0] && insert.rows[0].role_id;

        // ================================
        // CHECK DUPLICATE MODULE IDS
        // ================================
        const moduleIds = data.map(d => d.module_id);

        // find duplicates
        const duplicateModules = moduleIds.filter((id, index) => moduleIds.indexOf(id) !== index);

        if (duplicateModules.length > 0) {
            return cb(null, {
                status: false,
                code: 2003,
                error: `Duplicate module_id found: ${[...new Set(duplicateModules)].join(', ')}`
            });
        }


        // ================================
        // CHECK DUPLICATE PROFILE IDS
        // ================================
        const profileIds = profile_data.map(p => p.profile_id);

        // Find duplicates
        const duplicates = profileIds.filter((id, index) => profileIds.indexOf(id) !== index);

        if (duplicates.length > 0) {
            return cb(null, {
                status: false,
                code: 2002,
                error: `Duplicate profile_id found: ${[...new Set(duplicates)].join(', ')}`
            });
        }


        for (const item of data) {
            const {
                module_id,
                createaccess = 0,
                editaccess = 0,
                deleteaccess = 0,
                listaccess = 0,
                viewaccess = 0,
                printaccess = 0,
                cloneaccess = 0
            } = item;

            // Check existing role_data_access row
            const check = await client.query(
                `SELECT role_access_id, role_access_uuid 
         FROM role_data_access
         WHERE role_id = $1 AND module_id = $2 AND is_deleted = false`,
                [role_id, module_id]
            );

            let role_access_id;
            let roleAccessUUID;

            // ---------- UPDATE ----------
            if (check.rowCount > 0) {
                role_access_id = check.rows[0].role_access_id;
                roleAccessUUID = check.rows[0].role_access_uuid;

                await client.query(
                    `UPDATE role_data_access SET
            createaccess = $1,
            editaccess   = $2,
            deleteaccess= $3,
            listaccess  = $4,
            viewaccess  = $5,
            printaccess= $6,
            cloneaccess= $7,
            modified_at= NOW(),
            modified_by= $8
           WHERE role_access_id = $9`,
                    [
                        createaccess,
                        editaccess,
                        deleteaccess,
                        listaccess,
                        viewaccess,
                        printaccess,
                        cloneaccess,
                        created_by,
                        role_access_id
                    ]
                );

            }
            // ---------- CREATE ----------
            else {
                const insert = await client.query(
                    `INSERT INTO role_data_access(
            role_id,
            module_id,
            createaccess,
            editaccess,
            deleteaccess,
            listaccess,
            viewaccess,
            printaccess,
            cloneaccess,
            created_by,
            assigned_to
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          RETURNING role_access_id, role_access_uuid`,
                    [
                        role_id,
                        module_id,
                        createaccess,
                        editaccess,
                        deleteaccess,
                        listaccess,
                        viewaccess,
                        printaccess,
                        cloneaccess,
                        created_by,
                        created_by
                    ]
                );

                role_access_id = insert.rows[0].role_access_id;
                roleAccessUUID = insert.rows[0].role_access_uuid;
            }


            // ===============================
            // REMOVE UNSELECTED PROFILES
            // ===============================
            const existingProfiles = await client.query(
                `SELECT role_profile_id, profile_id 
   FROM role_profile_mapping
   WHERE role_access_id = $1 
     AND is_deleted = false`,
                [role_access_id]
            );

            const existingIds = existingProfiles.rows.map(r => r.profile_id);
            const incomingIds = profile_data.map(p => p.profile_id);

            // find removed ones
            const removedIds = existingIds.filter(id => !incomingIds.includes(id));

            // Soft delete removed mappings
            if (removedIds.length > 0) {
                await client.query(
                    `UPDATE role_profile_mapping
     SET is_deleted = true,
         is_active = false,
         deleted_at = NOW(),
         deleted_by = $1
     WHERE role_access_id = $2
       AND profile_id = ANY($3::int[])`,
                    [created_by, role_access_id, removedIds]
                );
            }


            // ==================================================
            // HANDLE ROLE → PROFILE MAPPING
            // ==================================================
            for (const prof of profile_data) {

                const exists = await client.query(
                    `SELECT role_profile_id 
     FROM role_profile_mapping
     WHERE role_access_id = $1
       AND profile_id = $2
       AND is_deleted = false`,
                    [role_access_id, prof.profile_id]
                );

                // CREATE mapping if not exists
                if (exists.rowCount === 0) {
                    await client.query(
                        `INSERT INTO role_profile_mapping(
              role_access_id,
              profile_id,
              role_id,
              is_active,
              created_by,
              assigned_to
            )
            VALUES ($1,$2,$3,true,$4,$4)`,
                        [role_access_id, prof.profile_id, role_id, created_by]
                    );
                }
                // UPDATE mapping if exists → just refresh role_access_id
                // else {
                //   await client.query(
                //     `UPDATE role_profile_mapping
                //      SET role_access_id = $1,
                //          modified_at = NOW(),
                //          modified_by = $2
                //      WHERE role_profile_id = $3`,
                //     [role_access_id, created_by, exists.rows[0].role_profile_id]
                //   );
                // }

                // UPDATE mapping if exists
                else {
                    await client.query(
                        `UPDATE role_profile_mapping
       SET modified_at = NOW(),
           modified_by = $1
       WHERE role_profile_id = $2`,
                        [created_by, exists.rows[0].role_profile_id]
                    );
                }
            }



            // ==================================================
            // HANDLE USER → PROFILE MAPPING BASED ON ROLE
            // ==================================================

            // Step 1: Get all active users for this role
            const usersResult = await client.query(
                `SELECT user_id 
   FROM users 
   WHERE role_id = $1 AND is_deleted = false`,
                [role_id]
            );
            const userIds = usersResult.rows.map(u => u.user_id);

            // Step 2: Get active profiles for this role
            const roleProfilesResult = await client.query(
                `SELECT DISTINCT profile_id 
   FROM role_profile_mapping
   WHERE role_id = $1 AND is_deleted = false`,
                [role_id]
            );
            const activeProfileIds = roleProfilesResult.rows.map(p => p.profile_id);

            // ==================================================
            // INSERT or UNDELETE required mappings
            // ==================================================
            for (const user_id of userIds) {
                for (const profile_id of activeProfileIds) {

                    const check = await client.query(
                        `SELECT user_profile_id, is_deleted 
       FROM user_profile_mapping
       WHERE user_id = $1 AND profile_id = $2`,
                        [user_id, profile_id]
                    );

                    if (check.rowCount === 0) {
                        // Create mapping
                        await client.query(
                            `INSERT INTO user_profile_mapping
         (role_id,user_id, profile_id, is_active, created_by, assigned_to)
         VALUES ($1,$2,$3,true,$4,$4)`,
                            [role_id, user_id, profile_id, created_by]
                        );
                    }
                    else if (check.rows[0].is_deleted === true) {
                        // Undelete mapping
                        await client.query(
                            `UPDATE user_profile_mapping
         SET is_deleted = false,
             is_active = true,
             modified_at = NOW(),
             modified_by = $1
         WHERE user_profile_id = $2`,
                            [created_by, check.rows[0].user_profile_id]
                        );
                    }
                }
            }

            // ==================================================
            // REMOVE user_profile_mapping for removed role profiles
            // ==================================================

            // find user-profile rows that should NOT exist anymore
            await client.query(
                `UPDATE user_profile_mapping upm
   SET is_deleted = true,
       is_active = false,
       deleted_at = NOW(),
       deleted_by = $1
   WHERE upm.user_id = ANY($2::int[])
     AND upm.profile_id NOT IN (
        SELECT profile_id 
        FROM role_profile_mapping 
        WHERE role_id = $3 AND is_deleted = false
     )`,
                [created_by, userIds, role_id]
            );

        }

        await client.query("COMMIT");

        return cb(null, {
            status: true, code: 1000,
            message: "Role Data Access Saved Successfully"
        });

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("ERROR:", error);

        return cb(null, {
            status: false, code: 2004,
            message: "Internal Server Error",
            error: error.message
        });

    } finally {
        client.release();
    }
});



// ===================================================
// FETCH ROLE → MODULE → PROFILE DETAILS
// ===================================================
responder.on("fetch-role-data-access-details", async (req, cb) => {
    try {
        const { role_id } = req.body;

        if (!role_id) {
            return cb(null, {
                status: false,
                code: 2001,
                error: "role_id is required"
            });
        }

        // 1. Fetch all role_data_access rows for this role
        const accessRes = await pool.query(
            `SELECT role_access_id,
              module_id,
              createaccess,
              editaccess,
              deleteaccess,
              listaccess,
              viewaccess,
              printaccess,
              cloneaccess
       FROM role_data_access
       WHERE role_id = $1
         AND is_deleted = false`,
            [role_id]
        );

        if (accessRes.rowCount === 0) {
            return cb(null, { status: true, data: [] });
        }

        const data = [];
        const profileSet = new Set(); // to build profile_data

        // 2. For each module get mapped profiles
        for (const row of accessRes.rows) {

            const profRes = await pool.query(
                `SELECT profile_id
         FROM role_profile_mapping
         WHERE role_access_id = $1
           AND is_deleted = false`,
                [row.role_access_id]
            );

            // Collect unique profile list
            profRes.rows.forEach(p => profileSet.add(p.profile_id));

            data.push({
                module_id: row.module_id,
                createaccess: row.createaccess,
                editaccess: row.editaccess,
                deleteaccess: row.deleteaccess,
                listaccess: row.listaccess,
                viewaccess: row.viewaccess,
                printaccess: row.printaccess,
                cloneaccess: row.cloneaccess,
                profiles: profRes.rows // [{profile_id:..}]
            });
        }

        // 3. Build profile_data array
        const profile_data = [...profileSet].map(id => ({ profile_id: id }));

        return cb(null, {
            status: true, code: 1000,
            message: "Access list fetched successfully",
            data: {
                role_id,
                data,
                profile_data
            }
        });

    } catch (error) {
        console.error("FETCH ROLE ACCESS DETAILS ERROR:", error);
        return cb(null, {
            status: false, code: 2004,
            message: "Internal Server Error",
            error: error.message
        });
    }
});


