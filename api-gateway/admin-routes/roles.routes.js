require('module-alias/register');

const express = require('express');
const router = express.Router();
const roleRequester = require('@libs/requesters/admin-requesters/roles-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


// --------------------------------------
// CREATE ROLE
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'create-role',
            body: req.body
        });
        // If responder returned  server error → return HTTP 500
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'create-role',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        //return HTTP 201
        res.status(201).send(result);
    } catch (err) {
        logger.error("Error in roles/create:", err.message);
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
// LIST ALL ROLES
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await roleRequester.send({ type: 'list-role' });
        // If responder returned  server error → return HTTP 500
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'list-role',
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
        logger.error("Error in roles/list:", err.message);
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
// FIND ROLE BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'getById-role',
            role_uuid: req.params.id
        });
        // If responder returned  server error → return HTTP 500
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'getById-role',
                method: 'GET',
                payload: { role_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in roles/findbyid:", err.message);
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
// UPDATE ROLE (Corrected Endpoint)
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'update-role',
            role_uuid: req.params.id,
            body: req.body
        });
        // If responder returned  server error → return HTTP 500
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'update-role',
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
        logger.error("Error in roles/update:", err.message);
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
// DELETE ROLE
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'delete-role',
            role_uuid: req.params.id,
            body: req.body
        });
        // If responder returned  server error → return HTTP 500
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'delete-role',
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
        logger.error("Error in roles/delete:", err.message);
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
// STATUS CHANGE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'status-role',
            role_uuid: req.params.id,
            body: req.body
        });
        // If responder returned  server error → return HTTP 500
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'status-role',
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
        logger.error("Error in roles/delete:", err.message);
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
// ADVANCE FILTER LIST API
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'advancefilter-role',
            body: req.body
        });
        // If responder returned  server error → return HTTP 500
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'advancefilter-role',
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
// CLONE ROLE
// --------------------------------------
router.post('/clone/:id', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'clone-role',
            role_uuid: req.params.id,
            body: req.body
        });

        // If responder returned  server error → return HTTP 500
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'clone-role',
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
        logger.error("Error in roles/clone:", err.message);
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
