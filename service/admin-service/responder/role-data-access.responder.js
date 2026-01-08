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
// CREATE | UPDATE ROLE DATA ACCESS  (SAME EVENT)
// ===================================================
responder.on("create-update-role-data-access", async (req, cb) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const {
            roleaccess_uuid,
            role_id,
            module_id,
            fullgrantaccess = false,
            createaccess = false,
            editaccess = false,
            deleteaccess = false,
            listaccess = false,
            viewaccess = false,
            printaccess = false,
            cloneaccess = false,
            created_by
        } = req.body;

        let finalUUID = roleaccess_uuid;

        // ---------------- UPDATE CASE ----------------
        if (roleaccess_uuid) {

            const check = await client.query(
                `SELECT roleaccess_id FROM role_data_access 
                     WHERE roleaccess_uuid = $1 AND is_deleted = false`,
                [roleaccess_uuid]
            );

            if (check.rowCount > 0) {
                await client.query(
                    `UPDATE role_data_access SET
                            role_id = $1,
                            module_id = $2,
                            fullgrantaccess = $3,
                            createaccess = $4,
                            editaccess = $5,
                            deleteaccess = $6,
                            listaccess = $7,
                            viewaccess = $8,
                            printaccess = $9,
                            cloneaccess = $10,
                            modified_at = NOW(),
                            modified_by = $11
                         WHERE roleaccess_uuid = $12`,
                    [
                        role_id,
                        module_id,
                        fullgrantaccess,
                        createaccess,
                        editaccess,
                        deleteaccess,
                        listaccess,
                        viewaccess,
                        printaccess,
                        cloneaccess,
                        created_by,
                        roleaccess_uuid
                    ]
                );

                await client.query("COMMIT");
                return cb(null, {
                    status: true,
                    message: "Role Data Access Updated Successfully",
                    roleaccess_uuid
                });
            }
        }

        // ---------------- CREATE CASE ----------------
        finalUUID = uuidv4();

        await client.query(
            `INSERT INTO role_data_access(
                    roleaccess_uuid,
                    role_id,
                    module_id,
                    fullgrantaccess,
                    createaccess,
                    editaccess,
                    deleteaccess,
                    listaccess,
                    viewaccess,
                    printaccess,
                    cloneaccess,
                    created_by
                ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
                finalUUID,
                role_id,
                module_id,
                fullgrantaccess,
                createaccess,
                editaccess,
                deleteaccess,
                listaccess,
                viewaccess,
                printaccess,
                cloneaccess,
                created_by
            ]
        );

        await client.query("COMMIT");
        return cb(null, {
            status: true,
            message: "Role Data Access Created Successfully",
            roleaccess_uuid: finalUUID
        });

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("ERROR:", error);
        cb({
            status: false,
            message: "Internal Server Error",
            error: error.message
        });
    } finally {
        client.release();
    }
});


// ===================================================
// LIST ROLE DATA ACCESS
// ===================================================
responder.on("list-role-data-access", async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT * FROM role_data_access
                 WHERE is_deleted = false
                 ORDER BY created_at DESC`
        );

        cb(null, {
            status: true,
            message: "Role Data Access List",
            data: result.rows
        });

    } catch (error) {
        console.error("ERROR:", error);
        cb({
            status: false,
            message: "Internal Server Error",
            error: error.message
        });
    }
});

