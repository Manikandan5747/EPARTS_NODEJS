require('module-alias/register');

const express = require('express');
const router = express.Router();
const usersRequester = require('@libs/requesters/seller-requesters/users-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


// --------------------------------------
// LIST ALL USERS
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await usersRequester.send({ type: 'list-users' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-users',
                method: 'GET',
                payload: null,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in users/list:", err.message);
        await saveErrorLog({
            api_name: 'list-users',
            method: 'GET',
            payload: null,
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
// PAGINATION LIST
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'advancefilter-users',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-users',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });

            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name: 'advancefilter-users',
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
            type: 'login',
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
// LOGOUT USER
// --------------------------------------
router.post('/logout', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'seller-logout',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'seller-logout',
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
        logger.error("Error in users/seller-logout:", err.message);

        await saveErrorLog({
            api_name: 'seller-logout',
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
