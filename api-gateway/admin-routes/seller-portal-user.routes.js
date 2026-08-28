require('module-alias/register');

const express = require('express');
const router = express.Router();
const sellerportaluserRequester = require('@libs/requesters/admin-requesters/seller-portal-user-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
const uploadDir = path.join('/app/assets', 'seller-portal-users');
const multipartMiddleware = multipart({ uploadDir });


// --------------------------------------
// CREATE SELLER PORTAL USERS
// --------------------------------------

router.post('/create', multipartMiddleware, async (req, res) => {
    try {
        const profileIconPath = req.files?.profile_icon?.path || null;

        const result = await sellerportaluserRequester.send({
            type: 'create-seller-portal-users',
            body: {
                ...req.body,
                profile_icon: profileIconPath
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-seller-portal-users',
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
        logger.error("Error in seller-portal-users/create:", err.message);
        await saveErrorLog({
            api_name: 'create-seller-portal-users',
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
// LIST ALL SELLER PORTAL USERS
// --------------------------------------

router.get('/list', async (req, res) => {
    try {
        const result = await sellerportaluserRequester.send({ type: 'list-seller-portal-users' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-seller-portal-users',
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
        logger.error("Error in list-seller-portal-users:", err.message);
        await saveErrorLog({
            api_name: 'list-seller-portal-users',
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
// FIND SELLER PORTAL USER BY ID
// --------------------------------------

router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await sellerportaluserRequester.send({
            type: 'getById-seller-portal-users',
            portal_user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-seller-portal-users',
                method: 'GET',
                payload: req.params,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error("Error in findbyid-seller-portal-users:", err.message);
        await saveErrorLog({
            api_name: 'getById-seller-portal-users',
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
// UPDATE SELLER PORTAL USERS
// --------------------------------------

router.post('/update/:id', multipartMiddleware, async (req, res) => {
    try {
        const profileIconPath = req.files?.profile_icon?.path || null;

        const result = await sellerportaluserRequester.send({
            type: 'update-seller-portal-users',
            portal_user_uuid: req.params.id,
            body: {
                ...req.body,
                profile_icon: profileIconPath
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-seller-portal-users',
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
        logger.error("Error in seller-portal-users/update:", err.message);
        await saveErrorLog({
            api_name: 'update-seller-portal-users',
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
// DELETE SELLER PORTAL USERS
// --------------------------------------

router.post('/delete/:id', async (req, res) => {
    try {
        const result = await sellerportaluserRequester.send({
            type: 'delete-seller-portal-users',
            portal_user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-seller-portal-users',
                method: 'POST',
                payload: { params: req.params, body: req.body },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in delete-seller-portal-users:", err.message);
        await saveErrorLog({
            api_name: 'delete-seller-portal-users',
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
// STATUS CHANGE SELLER PORTAL USERS
// --------------------------------------

router.post('/status/:id', async (req, res) => {
    try {
        const result = await sellerportaluserRequester.send({
            type: 'status-seller-portal-users',
            portal_user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-seller-portal-users',
                method: 'POST',
                payload: { params: req.params, body: req.body },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in status-seller-portal-users:", err.message);
        await saveErrorLog({
            api_name: 'status-seller-portal-users',
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
        const result = await sellerportaluserRequester.send({
            type: 'advancefilter-portal-users',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-portal-users',
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
        logger.error("Error in advancefilter-portal-users:", err.message);
        await saveErrorLog({
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
// UNLOCK RECORD (SAVE / CANCEL)
// --------------------------------------

router.post('/unlock/:id', async (req, res) => {
    try {
        const result = await sellerportaluserRequester.send({
            type: 'unlock-seller-portal-user',
            uuid: req.params.id,
            body: { user_id: req.body.user_id }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'unlock-seller-portal-user',
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
        logger.error("Error in unlock-seller-portal-user:", err.message);
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
// APPROVE / REJECT SELLER PORTAL USERS
// --------------------------------------

router.post('/approve-reject/:id', async (req, res) => {
    try {
        const result = await sellerportaluserRequester.send({
            type: 'approve-reject-seller-portal-users',
            portal_user_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'approve-reject-seller-portal-users',
                method: 'POST',
                payload: { params: req.params, body: req.body },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in approve-reject-seller-portal-users:", err.message);
        await saveErrorLog({
            api_name: 'approve-reject-seller-portal-users',
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