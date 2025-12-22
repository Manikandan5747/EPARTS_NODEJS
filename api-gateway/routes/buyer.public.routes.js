require('module-alias/register');

const express = require('express');
const router = express.Router();
const usersRequester = require('@libs/requesters/admin-requesters/users-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


// --------------------------------------
// LOGIN USER
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
            type: 'buyer-login',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'login',
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
        logger.error("Error in users/login:", err.message);

        await saveErrorLog({
            api_name: 'login',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// FORGOT PASSWORD USER
// --------------------------------------
router.post('/forgotpassword', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'forgotpassword-buyer',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'forgotpassword-buyer',
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
        logger.error("Error in users/forgotpassword-buyer:", err.message);

        await saveErrorLog({
            api_name: 'forgotpassword-buyer',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// CHANGE PASSWORD USER
// --------------------------------------
router.post('/changepassword', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'changepassword-buyer',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'changepassword-buyer',
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
        logger.error("Error in users/changepassword-buyer:", err.message);

        await saveErrorLog({
            api_name: 'changepassword-buyer',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

        res.status(500).json({ error: err.message });
    }
});



module.exports = router;
