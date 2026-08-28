require('module-alias/register');

const express = require('express');
const router = express.Router();
const buyerportaluserRequester = require('@libs/requesters/admin-requesters/buyer-portal-user-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
const uploadDir = path.join('/app/assets', 'buyer-portal-users');
const multipartMiddleware = multipart({ uploadDir });


// --------------------------------------
// CREATE BUYER PORTAL USERS
// --------------------------------------

router.post('/create', multipartMiddleware, async (req, res) => {
    try {
        // FILE
        const profileIconPath = req.files?.profile_icon?.path || null;
        
        const result = await buyerportaluserRequester.send({
            type: 'create-buyer-portal-users',
            body: {
                ...req.body,
                profile_icon: profileIconPath
            }
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'create-buyer-portal-users',
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
        logger.error("Error in buyer-portal-users/create:", err.message);
        await saveErrorLog({
            api_name: 'create-buyer-portal-users',
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
// LIST ALL BUYER PORTAL USERS
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await buyerportaluserRequester.send({ type: 'list-buyer-portal-users' });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'list-buyer-portal-users',
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
        logger.error("Error in list-buyer-portal-users:", err.message);
        await saveErrorLog({
            api_name: 'list-buyer-portal-users',
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
        const result = await buyerportaluserRequester.send({
            type: 'getById-buyer-portal-users',
            portal_user_uuid: req.params.id,
body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog( {
                api_name: 'getById-buyer-portal-users',
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

        await saveErrorLog( {
            api_name: 'getById-buyer-portal-users',
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
// UPDATE BUYER PORTAL USERS
// --------------------------------------

router.post('/update/:id', multipartMiddleware, async (req, res) => {
    try {
        // FILE
        const profileIconPath = req.files?.profile_icon_path?.path || null;
        const result = await buyerportaluserRequester.send({
            type: 'update-buyer-portal-users',
            portal_user_uuid: req.params.id,
            body: {
                ...req.body,
                profile_icon: profileIconPath
            }

        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'update-buyer-portal-users',
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
            api_name: 'update-buyer-portal-users',
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
// DELETE PORTAL USERS
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await buyerportaluserRequester.send({
            type: 'delete-buyer-portal-users',
            portal_user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'delete-buyer-portal-users',
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
        logger.error("Error in delete-buyer-portal-users:", err.message);

        await saveErrorLog({
            api_name: 'delete-buyer-portal-users',
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
        const result = await buyerportaluserRequester.send({
            type: 'status-buyer-portal-users',
            portal_user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'status-buyer-portal-users',
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
        logger.error("Error in status-buyer-portal-users:", err.message);

        await saveErrorLog({
            api_name: 'status-buyer-portal-users',
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
// UNLOCK RECORD (SAVE / CANCEL)
// --------------------------------------

router.post('/unlock/:id', async (req, res) => {
    try {
        const result = await buyerportaluserRequester.send({
            type: `unlock-buyer-portal-user`,
            uuid: req.params.id,
            body: { user_id: req.body.user_id }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: `unlock-buyer-portal-user`,
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

// --------------------------------------
// APPROVE / REJECT BUYER PORTAL USERS
// --------------------------------------

router.post('/approve-reject/:id', async (req, res) => {
    try {
        const result = await buyerportaluserRequester.send({
            type: 'approve-reject-buyer-portal-users',
            portal_user_uuid: req.params.id,
            body: req.body
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'approve-reject-buyer-portal-users',
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
        logger.error("Error in approve-reject-buyer-portal-users:", err.message);
        await saveErrorLog({
            api_name: 'approve-reject-buyer-portal-users',
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

module.exports = router;
