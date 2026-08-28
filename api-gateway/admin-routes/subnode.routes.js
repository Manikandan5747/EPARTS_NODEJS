const express = require('express');
const router = express.Router();
const subnodeRequester = require('@libs/requesters/admin-requesters/subnode-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
const uploadDir = path.join('/app/assets', 'subnode');
const multipartMiddleware = multipart({ uploadDir });
const multer = require('multer');

// --------------------------------------
// CREATE SUB NODE
// --------------------------------------
router.post('/create',multipartMiddleware, async (req, res) => {
    try {
        
        const imagePath = req.files?.image?.path || null;
        const result = await subnodeRequester.send({
            type: 'create-sub-node',
            body: {
                ...req.body,
                image_path: imagePath

            }
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-sub-node',
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
        logger.error("Error in sub-node/create:", err.message);
        await saveErrorLog({
            api_name: 'create-sub-node',
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
// GET SUB NODE BY UUID
// --------------------------------------
router.get('/findbyid/:sub_node_uuid', async (req, res) => {
    try {
        const result = await subnodeRequester.send({
            type         : 'getById-sub-node',
            sub_node_uuid: req.params.sub_node_uuid,
            body         : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'getById-sub-node',
                method    : 'GET',
                payload   : { sub_node_uuid: req.params.sub_node_uuid },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'getById-sub-node',
            method    : 'GET',
            payload   : { sub_node_uuid: req.params.sub_node_uuid },
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
// UPDATE SUB NODE
// --------------------------------------
router.post('/update/:sub_node_uuid',multipartMiddleware, async (req, res) => {
    try {
         const imagePath = req.files?.image?.path || null;
        const result = await subnodeRequester.send({
            type         : 'update-sub-node',
            sub_node_uuid: req.params.sub_node_uuid,
            body         : req.body,
            image_path: imagePath

        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'update-sub-node',
                method    : 'POST',
                payload   : { sub_node_uuid: req.params.sub_node_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'update-sub-node',
            method    : 'POST',
            payload   : { sub_node_uuid: req.params.sub_node_uuid, ...req.body },
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
// DELETE SUB NODE
// --------------------------------------
router.post('/delete/:sub_node_uuid', async (req, res) => {
    try {
        const result = await subnodeRequester.send({
            type         : 'delete-sub-node',
            sub_node_uuid: req.params.sub_node_uuid,
            body         : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'delete-sub-node',
                method    : 'POST',
                payload   : { sub_node_uuid: req.params.sub_node_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'delete-sub-node',
            method    : 'POST',
            payload   : { sub_node_uuid: req.params.sub_node_uuid, ...req.body },
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
// STATUS TOGGLE — SUB NODE
// --------------------------------------
router.post('/status/:sub_node_uuid', async (req, res) => {
    try {
        const result = await subnodeRequester.send({
            type         : 'status-sub-node',
            sub_node_uuid: req.params.sub_node_uuid,
            body         : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'status-sub-node',
                method    : 'POST',
                payload   : { sub_node_uuid: req.params.sub_node_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'status-sub-node',
            method    : 'POST',
            payload   : { sub_node_uuid: req.params.sub_node_uuid, ...req.body },
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
// UNLOCK SUB NODE RECORD
// --------------------------------------
router.post('/unlock/:sub_node_uuid', async (req, res) => {
    try {
        const result = await subnodeRequester.send({
            type         : 'unlock-sub-node',
            sub_node_uuid: req.params.sub_node_uuid,
            body         : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'unlock-sub-node',
                method    : 'POST',
                payload   : { sub_node_uuid: req.params.sub_node_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'unlock-sub-node',
            method    : 'POST',
            payload   : { sub_node_uuid: req.params.sub_node_uuid, ...req.body },
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
// ADVANCE FILTER LIST — SUB NODES
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await subnodeRequester.send({
            type: 'advancefilter-sub-nodes',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'advancefilter-sub-nodes',
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
            api_name  : 'advancefilter-sub-nodes',
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
