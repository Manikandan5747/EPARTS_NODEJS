require('module-alias/register');

const express = require('express');
const router = express.Router();
const portalusersRequester = require('@libs/requesters/admin-requesters/portal-users.requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


// --------------------------------------
// CREATE PORTAL USERS
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await portalusersRequester.send({
            type: 'create-portal-users',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog(req.pool, {
                api_name: 'create-portal-users',
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
        logger.error("Error in create-portal-users:", err.message);

        await saveErrorLog(req.pool, {
            api_name: 'create-portal-users',
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
// LIST ALL PORTAL USERS
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await portalusersRequester.send({ type: 'list-portal-users' });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog(req.pool, {
                api_name: 'list-portal-users',
                method: 'GET',
                payload: null,
                message: result.error,
                stack: result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in list-portal-users:", err.message);

        await saveErrorLog(req.pool, {
            api_name: 'list-portal-users',
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
// FIND PORTAL USERS BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await portalusersRequester.send({
            type: 'getById-portal-users',
            portal_user_uuid: req.params.id
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog(req.pool, {
                api_name: 'getById-portal-users',
                method: 'GET',
                payload: req.params,
                message: result.error,
                stack: result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error("Error in findbyid-portal-users:", err.message);

        await saveErrorLog(req.pool, {
            api_name: 'getById-portal-users',
            method: 'GET',
            payload: req.params,
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
// UPDATE PORTAL USERS
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await portalusersRequester.send({
            type: 'update-portal-users',
            portal_user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog(req.pool, {
                api_name: 'update-portal-users',
                method: 'POST',
                payload: { params: req.params, body: req.body },
                message: result.error,
                stack: result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in update-portal-users:", err.message);

        await saveErrorLog(req.pool, {
            api_name: 'update-portal-users',
            method: 'POST',
            payload: { params: req.params, body: req.body },
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
// DELETE PORTAL USERS
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await portalusersRequester.send({
            type: 'delete-portal-users',
            portal_user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog(req.pool, {
                api_name: 'delete-portal-users',
                method: 'POST',
                payload: { params: req.params, body: req.body },
                message: result.error,
                stack: result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in delete-portal-users:", err.message);

        await saveErrorLog(req.pool, {
            api_name: 'delete-portal-users',
            method: 'POST',
            payload: { params: req.params, body: req.body },
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
// STATUS CHANGE PORTAL USERS
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await portalusersRequester.send({
            type: 'status-portal-users',
            portal_user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog(req.pool, {
                api_name: 'status-portal-users',
                method: 'POST',
                payload: { params: req.params, body: req.body },
                message: result.error,
                stack: result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in status-portal-users:", err.message);

        await saveErrorLog(req.pool, {
            api_name: 'status-portal-users',
            method: 'POST',
            payload: { params: req.params, body: req.body },
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
// ADVANCE FILTER LIST
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await portalusersRequester.send({
            type: 'advancefilter-portal-users',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog(req.pool, {
                api_name: 'advancefilter-portal-users',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {

        await saveErrorLog(req.pool, {
            api_name: 'advancefilter-portal-users',
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
// CLONE PORTAL USERS
// --------------------------------------
router.post('/clone/:id', async (req, res) => {
    try {
        const result = await portalusersRequester.send({
            type: 'clone-portal-users',
            portal_user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog(req.pool, {
                api_name: 'clone-portal-users',
                method: 'POST',
                payload: { params: req.params, body: req.body },
                message: result.error,
                stack: result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in clone-portal-users:", err.message);

        await saveErrorLog(req.pool, {
            api_name: 'clone-portal-users',
            method: 'POST',
            payload: { params: req.params, body: req.body },
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
// LOGIN PORTAL USER
// --------------------------------------
router.post('/login', async (req, res) => {
    try {
        const result = await portalusersRequester.send({
            type: 'login-portal-users',
            body: req.body
        });

        res.send(result);

    } catch (err) {
        logger.error("Error in login-portal-users:", err.message);
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
// LOGOUT PORTAL USER
// --------------------------------------
router.post('/logout', async (req, res) => {
    try {
        const result = await portalusersRequester.send({
            type: 'logout-portal-users',
            body: req.body
        });

        res.send(result);

    } catch (err) {
        logger.error("Error in logout-portal-users:", err.message);
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
