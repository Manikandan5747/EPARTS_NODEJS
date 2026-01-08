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
}




