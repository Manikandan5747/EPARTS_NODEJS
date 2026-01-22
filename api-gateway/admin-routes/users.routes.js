require('module-alias/register');

const express = require('express');
const router = express.Router();
const usersRequester = require('@libs/requesters/admin-requesters/users-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');

// --------------------------------------
// CREATE USERS
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'create-users',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'create-users',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(201).send(result);

    } catch (err) {
        logger.error("Error in users/create:", err.message);
        await saveErrorLog({
            api_name: 'create-users',
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
// LIST ALL USERS
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await usersRequester.send({ type: 'list-users' });

        if (!result.status) {
            // SAVE ERROR LOG
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
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// FIND USERS BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'getById-users',
            user_uuid: req.params.id
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'getById-users',
                method: 'GET',
                payload: { user_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error("Error in users/findbyid:", err.message);

        await saveErrorLog({
            api_name: 'getById-users',
            method: 'GET',
            payload: { user_uuid: req.params.id },
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// UPDATE USERS
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'update-users',
            user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'update-users',
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
        logger.error("Error in users/update:", err.message);

        await saveErrorLog({
            api_name: 'update-users',
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
// DELETE USERS
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'delete-users',
            user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'delete-users',
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
        logger.error("Error in users/delete:", err.message);

        await saveErrorLog({
            api_name: 'delete-users',
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
// STATUS CHANGE USERS
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'status-users',
            user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'status-users',
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
        logger.error("Error in users/status:", err.message);

        await saveErrorLog({
            api_name: 'status-users',
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
// PAGINATION LIST
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'advancefilter-users',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
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

        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// CLONE USERS
// --------------------------------------
router.post('/clone/:id', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'clone-users',
            user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'clone-users',
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
        logger.error("Error in users/clone:", err.message);

        await saveErrorLog({
            api_name: 'clone-users',
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
// LOGOUT USER
// --------------------------------------
router.post('/logout', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        console.log("authHeader",authHeader);
        req.body.access_token = authHeader;
         console.log("authHeader",req.body);
        const result = await usersRequester.send({
            type: 'logout',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'logout',
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
        logger.error("Error in users/logout:", err.message);

        await saveErrorLog({
            api_name: 'logout',
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
// get-next-prefix-refno
// --------------------------------------
router.get('/getprefixrefno/:name', async (req, res) => {
    try {

        const result = await usersRequester.send({
            type: 'get-next-prefix-refno',
               category_type: req.params.name,
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'get-next-prefix-refno',
                method: 'GET',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in get-next-prefix-refno:", err.message);

        await saveErrorLog({
            api_name: 'login',
            method: 'GET',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

        res.status(500).json({ error: err.message });
    }
});







module.exports = router;
