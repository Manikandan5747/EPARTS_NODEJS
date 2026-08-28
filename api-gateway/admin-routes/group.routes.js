const express = require('express');
const router = express.Router();
const groupRequester = require('@libs/requesters/admin-requesters/group-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
const uploadDir = path.join('/app/assets', 'group');
const multipartMiddleware = multipart({ uploadDir });
const multer = require('multer');

// --------------------------------------
// CREATE GROUP
// --------------------------------------
router.post('/create',multipartMiddleware, async (req, res) => {
    
    
    try {

        const imagePath = req.files?.image?.path || null;

        const result = await groupRequester.send({
            type: 'create-group',
            body: {
                ...req.body,
                image_path: imagePath

            }
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-group',
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
        logger.error("Error in group/create:", err.message);
        await saveErrorLog({
            api_name: 'create-group',
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
// GET GROUP BY UUID
// --------------------------------------
router.get('/findbyid/:group_uuid', async (req, res) => {
    try {
        const result = await groupRequester.send({
            type      : 'getById-group',
            group_uuid: req.params.group_uuid,
            body      : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'getById-group',
                method    : 'GET',
                payload   : { group_uuid: req.params.group_uuid },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'getById-group',
            method    : 'GET',
            payload   : { group_uuid: req.params.group_uuid },
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : err.message,
            error             : err.message
        });
    }
});


// --------------------------------------
// UPDATE GROUP
// --------------------------------------
router.post('/update/:group_uuid',multipartMiddleware, async (req, res) => {
    try {
        const imagePath = req.files?.image?.path || null;
        const result = await groupRequester.send({
            type      : 'update-group',
            group_uuid: req.params.group_uuid,
            body      : req.body,
            image_path: imagePath

        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'update-group',
                method    : 'POST',
                payload   : { group_uuid: req.params.group_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'update-group',
            method    : 'POST',
            payload   : { group_uuid: req.params.group_uuid, ...req.body },
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : err.message,
            error             : err.message
        });
    }
});


// --------------------------------------
// DELETE GROUP
// --------------------------------------
router.post('/delete/:group_uuid', async (req, res) => {
    try {
        const result = await groupRequester.send({
            type      : 'delete-group',
            group_uuid: req.params.group_uuid,
            body      : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'delete-group',
                method    : 'POST',
                payload   : { group_uuid: req.params.group_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'delete-group',
            method    : 'POST',
            payload   : { group_uuid: req.params.group_uuid, ...req.body },
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : err.message,
            error             : err.message
        });
    }
});


// --------------------------------------
// STATUS TOGGLE — GROUP
// --------------------------------------
router.post('/status/:group_uuid', async (req, res) => {
    try {
        const result = await groupRequester.send({
            type      : 'status-group',
            group_uuid: req.params.group_uuid,
            body      : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'status-group',
                method    : 'POST',
                payload   : { group_uuid: req.params.group_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'status-group',
            method    : 'POST',
            payload   : { group_uuid: req.params.group_uuid, ...req.body },
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : err.message,
            error             : err.message
        });
    }
});


// --------------------------------------
// UNLOCK GROUP RECORD
// --------------------------------------
router.post('/unlock/:group_uuid', async (req, res) => {
    try {
        const result = await groupRequester.send({
            type      : 'unlock-group',
            group_uuid: req.params.group_uuid,
            body      : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'unlock-group',
                method    : 'POST',
                payload   : { group_uuid: req.params.group_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'unlock-group',
            method    : 'POST',
            payload   : { group_uuid: req.params.group_uuid, ...req.body },
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : err.message,
            error             : err.message
        });
    }
});


// --------------------------------------
// ADVANCE FILTER LIST — GROUPS
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await groupRequester.send({
            type: 'advancefilter-groups',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'advancefilter-groups',
                method    : 'POST',
                payload   : req.body,
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'advancefilter-groups',
            method    : 'POST',
            payload   : req.body,
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : err.message,
            error             : err.message
        });
    }
});

module.exports = router;
