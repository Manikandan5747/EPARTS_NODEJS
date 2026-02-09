require('module-alias/register');

const express = require('express');
const router = express.Router();
const usersRequester = require('@libs/requesters/admin-requesters/users-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
//test
const uploadDir = path.join('/app/assets', 'users_icon');
const multipartMiddleware = multipart({ uploadDir });


// --------------------------------------
// CREATE USERS
// --------------------------------------
router.post('/create', multipartMiddleware, async (req, res) => {
    try {

        // FILE
        const profileIconPath = req.files?.profile_icon_path?.path || null;

        const result = await countryRequester.send({
            type: 'create-users',
            body: {
                ...req.body,
                profile_icon: profileIconPath
            }
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
// UPDATE USERS
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        // FILE
        const profileIconPath = req.files?.profile_icon_path?.path || null;
        const result = await usersRequester.send({
            type: 'update-users',
            user_uuid: req.params.id,
            body: {
                ...req.body,
                profile_icon: profileIconPath
            }
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
        const authHeader = req.headers.authorization;
        console.log("authHeader", authHeader);
        req.body.access_token = authHeader;
        console.log("authHeader", req.body);
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
// FIND USER BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {

        const mode = req.query.mode || 'view';
        const user_id = req.query.user_id;

        const result = await usersRequester.send({
            type: 'getById-user',
            user_uuid: req.params.id,
            mode,
            body: { user_id }
        });
        // If responder returned  server error → return HTTP 500
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'getById-user',
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
        logger.error("Error in user/findbyid:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// UNLOCK RECORD (SAVE / CANCEL)
// --------------------------------------

router.post('/unlock/:id', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: `unlock-user`,
            uuid: req.params.id,
            body: { user_id: req.body.user_id }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: `unlock-user`,
                method: 'POST',
                payload: {
                    uuid: req.params.id,
                    user_id: req.body.user_id
                },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });

            return res.status(500).json(result);
        }

        return res.json(result);

    } catch (err) {
        logger.error(err.message);
        return res.status(500).json({
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
