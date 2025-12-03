const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');


async function saveErrorLog(pool, {
    api_name,
    method,
    payload,
    message,
    stack,error_code
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
};



module.exports = { saveErrorLog };