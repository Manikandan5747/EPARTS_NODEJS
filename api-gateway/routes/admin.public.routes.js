require('module-alias/register');

const express = require('express');
// const csrf = require('csurf');
const router = express.Router();
const usersRequester = require('@libs/requesters/admin-requesters/users-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');

// CSRF Protection
// const csrfProtection = csrf({ cookie: true });


// --------------------------------------
// ADMIN LOGIN USER
// --------------------------------------
router.post('/login', async (req, res) => {
    try {

        // ------------------------------
        // Capture Device & Browser Info
        // ------------------------------
        const device_detail = req.headers['user-agent'] || 'Unknown Device';
        const browser_used =
            req.headers['sec-ch-ua'] ||
            req.headers['user-agent'] ||
            'Unknown Browser';

        // Attach to body so microservice can save in users_login table
        req.body.device_detail = device_detail;
        req.body.browser_used = browser_used;

        const result = await usersRequester.send({
            type: 'admin-login',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'login',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            // amazonq-ignore-next-line
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in users/login:", err.message);
        // SAVE ERROR LOG
        try {
            await saveErrorLog({
                api_name: 'login',
                method: 'POST',
                payload: req.body,
                message: err.message,
                stack: err.stack,
                error_code: 2004
            });
        } catch (logErr) {
            logger.error("Failed to save error log:", logErr.message);
        }

        res.status(500).json({
    header_type: "ERROR",
    message_visibility: true,
    status: false,
    code: 2004,
    message: err.message,
    error: err.message
});
    }
});


// --------------------------------------
// FORGOT PASSWORD USER
// --------------------------------------
router.post('/forgotpassword', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'forgotpassword-users',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'forgotpassword-users',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in users/forgotpassword-users:", err.message);

        await saveErrorLog({
            api_name: 'forgotpassword-users',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

        res.status(500).json({
    header_type: "ERROR",
    message_visibility: true,
    status: false,
    code: 2004,
    message: err.message,
    error: err.message
});
    }
});


// --------------------------------------
// CHANGE PASSWORD USER
// --------------------------------------
router.post('/changepassword', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'changepassword-users',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'changepassword-users',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in users/changepassword-users:", err.message);

        await saveErrorLog({
            api_name: 'changepassword-users',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

        res.status(500).json({
    header_type: "ERROR",
    message_visibility: true,
    status: false,
    code: 2004,
    message: err.message,
    error: err.message
});
    }
});








module.exports = router;
