const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
var nodemailer = require("nodemailer");

module.exports = {

    sendmail: async function (body) {
        return new Promise(async (resolve, reject) => {
            try {
                logger.info("Email Body: %o", body);

                const subject = body?.subject || "";
                const htmlContent = body?.content || "";
                const textContent = body?.description || "";
                const toMail = body?.tomail;

                if (!toMail) {
                    return reject(new Error("Recipient email (tomail) is required"));
                }

                const transporter = nodemailer.createTransport({
                    host: "smtp-mail.outlook.com",
                    port: 587,
                    secure: false,
                    auth: {
                        user: 'info@germanexperts.ae',
                        pass: 'Office@151008'
                    },
                    tls: {
                        rejectUnauthorized: false
                    }
                });

                const mailOptions = {
                    from: "info@germanexperts.ae",
                    to: toMail,
                    subject: subject,
                    html: htmlContent,
                    text: textContent
                };

                const info = await transporter.sendMail(mailOptions);
                logger.info("Email sent: %s", info.response);

                resolve(true);

            } catch (error) {
                logger.error("Email sending error: %o", error);
                reject(error);
            }
        });
    },

    saveErrorLog: async function ({
        api_name,
        method,
        payload,
        message,
        stack, error_code
    }) {
        try {
            await pool.query(
                `INSERT INTO api_error_logs 
            (api_name, method, request_payload, error_message, stack_trace,error_code)
            VALUES ($1, $2, $3, $4, $5,$6)`,
                [
                    api_name,
                    method,
                    payload ? JSON.stringify(payload) : null,
                    message,
                    stack,
                    error_code
                ]
            );
        } catch (err) {
            logger.error("Failed to write error log %o", err.message)
            console.error("Failed to write error log:", err.message);
        }
    },

    saveLoginLog: async function ({
        user_id = null,
        portal_user_id = null,
        device_detail = null,
        browser_used = null,
        created_by = null
    }) {
        try {

            //         /* -----------------------------------
            //    1️⃣ DEACTIVATE OLD LOGIN RECORDS
            // ------------------------------------ */
            //         await pool.query(`
            //     UPDATE users_login
            //     SET is_active = false, modified_at = NOW()
            //     WHERE
            //         ($1 IS NOT NULL AND user_id = $1)
            //         OR
            //     ($2 IS NOT NULL AND portal_user_id = $2)
            //   `,
            //             [user_id, portal_user_id]
            //         );
            const query = `
            INSERT INTO users_login 
                (user_id, portal_user_id, device_detail, browser_used, created_by)
            VALUES 
                ($1, $2, $3, $4, $5)
            RETURNING login_id, login_uuid, login_time;
        `;

            const values = [
                user_id,
                portal_user_id,
                device_detail,
                browser_used,
                created_by
            ];

            const result = await pool.query(query, values);
            console.log("loginDetails", result.rows[0]);

            return { status: true, data: result.rows[0] };

        } catch (err) {
            console.error("Error saving login log:", err.message);
            return { status: false, error: err.message };
        }

    },

    getAllSettingsCategory: function (setcategory) {
        return new Promise(async (resolve, reject) => {
            try {
                const response = await pool.query(
                    'SELECT * FROM settings where setcategory=$1 and is_active=true  ORDER BY setting_id ASC',
                    [setcategory],
                );
                resolve(response.rows);
            } catch (err) {
                console.error("Error saving login log:", err.message);
                reject(err);
            }
        });
    },

    createOrUpdateMisc: async function (body) {
        const { miscItems, module_id } = body;
        const created_by = body.created_by || body.modified_by;
        const client = await pool.connect();

        if (!miscItems || !Array.isArray(miscItems) || miscItems.length === 0) {
            return {
                status: false,
                message: 'No misc items to process.'
            };
        }

        try {
            await client.query('BEGIN');

            for (const item of miscItems) {

                const is_active = typeof item.is_active === 'boolean'
                    ? item.is_active
                    : true;

                // 🔹 Check if record exists based on module_id + misc_name
                const checkQuery = await client.query(
                    `SELECT misc_id 
                 FROM miscellaneous_mapping 
                 WHERE module_id = $1 
                 AND LOWER(misc_name) = LOWER($2)
                 AND is_deleted = FALSE`,
                    [module_id, item.misc_name]
                );

                if (checkQuery.rowCount > 0) {
                    // ---------------- UPDATE ----------------
                    await client.query(
                        `UPDATE miscellaneous_mapping 
                     SET is_active = $1,
                         modified_at = NOW(),
                         modified_by = $2
                     WHERE module_id = $3
                       AND LOWER(misc_name) = LOWER($4)
                       AND is_deleted = FALSE`,
                        [
                            is_active,
                            created_by,
                            module_id,
                            item.misc_name
                        ]
                    );

                } else {
                    // ---------------- CREATE ----------------
                    await client.query(
                        `INSERT INTO miscellaneous_mapping 
                     (misc_name, module_id, is_active, created_at, created_by, assigned_to)
                     VALUES ($1, $2, $3, NOW(), $4, $4)`,
                        [
                            item.misc_name,
                            module_id,
                            is_active,
                            created_by
                        ]
                    );
                }
            }

            await client.query('COMMIT');

            return {
                status: true,
                message: 'Miscellaneous items saved successfully'
            };

        } catch (err) {
            await client.query('ROLLBACK');
            console.error('Error processing misc items:', err);

            return {
                status: false,
                message: 'Error processing misc items',
                error: err.message
            };

        } finally {
            client.release();
        }
    },
}




