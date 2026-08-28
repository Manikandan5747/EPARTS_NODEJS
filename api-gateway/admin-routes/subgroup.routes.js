const express = require('express');
const router = express.Router();
const subgroupRequester = require('@libs/requesters/admin-requesters/subgroup-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
const uploadDir = path.join('/app/assets', 'subgroup');
const multipartMiddleware = multipart({ uploadDir });
const multer = require('multer');




// --------------------------------------
// CREATE SUB GROUP
// --------------------------------------
router.post('/create',multipartMiddleware, async (req, res) => {
    try {
        
        const imagePath = req.files?.image?.path || null;
        const result = await subgroupRequester.send({
            type: 'create-sub-group',
            body: {
                ...req.body,
                image_path: imagePath

            }
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-sub-group',
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
        logger.error("Error in sub-group/create:", err.message);
        await saveErrorLog({
            api_name: 'create-sub-group',
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
// GET SUB GROUP BY UUID
// --------------------------------------
router.get('/findbyid/:sub_group_uuid', async (req, res) => {
    try {
        const result = await subgroupRequester.send({
            type          : 'getById-sub-group',
            sub_group_uuid: req.params.sub_group_uuid,
            body          : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'getById-sub-group',
                method    : 'GET',
                payload   : { sub_group_uuid: req.params.sub_group_uuid },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'getById-sub-group',
            method    : 'GET',
            payload   : { sub_group_uuid: req.params.sub_group_uuid },
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
// UPDATE SUB GROUP
// --------------------------------------
router.post('/update/:sub_group_uuid',multipartMiddleware, async (req, res) => {
    try {
         const imagePath = req.files?.image?.path || null;
        const result = await subgroupRequester.send({
            type          : 'update-sub-group',
            sub_group_uuid: req.params.sub_group_uuid,
            body          : req.body,
            image_path: imagePath

        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'update-sub-group',
                method    : 'POST',
                payload   : { sub_group_uuid: req.params.sub_group_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'update-sub-group',
            method    : 'POST',
            payload   : { sub_group_uuid: req.params.sub_group_uuid, ...req.body },
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
// DELETE SUB GROUP
// --------------------------------------
router.post('/delete/:sub_group_uuid', async (req, res) => {
    try {
        const result = await subgroupRequester.send({
            type          : 'delete-sub-group',
            sub_group_uuid: req.params.sub_group_uuid,
            body          : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'delete-sub-group',
                method    : 'POST',
                payload   : { sub_group_uuid: req.params.sub_group_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'delete-sub-group',
            method    : 'POST',
            payload   : { sub_group_uuid: req.params.sub_group_uuid, ...req.body },
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
// STATUS TOGGLE — SUB GROUP
// --------------------------------------
router.post('/status/:sub_group_uuid', async (req, res) => {
    try {
        const result = await subgroupRequester.send({
            type          : 'status-sub-group',
            sub_group_uuid: req.params.sub_group_uuid,
            body          : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'status-sub-group',
                method    : 'POST',
                payload   : { sub_group_uuid: req.params.sub_group_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'status-sub-group',
            method    : 'POST',
            payload   : { sub_group_uuid: req.params.sub_group_uuid, ...req.body },
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
// UNLOCK SUB GROUP RECORD
// --------------------------------------
router.post('/unlock/:sub_group_uuid', async (req, res) => {
    try {
        const result = await subgroupRequester.send({
            type          : 'unlock-sub-group',
            sub_group_uuid: req.params.sub_group_uuid,
            body          : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'unlock-sub-group',
                method    : 'POST',
                payload   : { sub_group_uuid: req.params.sub_group_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'unlock-sub-group',
            method    : 'POST',
            payload   : { sub_group_uuid: req.params.sub_group_uuid, ...req.body },
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
// ADVANCE FILTER LIST — SUB GROUPS
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await subgroupRequester.send({
            type: 'advancefilter-sub-groups',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'advancefilter-sub-groups',
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
            api_name  : 'advancefilter-sub-groups',
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
