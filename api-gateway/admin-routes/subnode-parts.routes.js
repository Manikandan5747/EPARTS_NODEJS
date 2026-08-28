const express = require('express');
const router = express.Router();
const subnodePartsRequester = require('@libs/requesters/admin-requesters/subnode-parts-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');



// --------------------------------------
// CREATE SUB NODE PART
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await subnodePartsRequester.send({
            type: 'create-sub-node-part',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'create-sub-node-part',
                method    : 'POST',
                payload   : req.body,
                message   : result.error,
                stack     : result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(201).send(result);

    } catch (err) {
        logger.error("Error in sub-node-part/create:", err.message);
        await saveErrorLog({
            api_name  : 'create-sub-node-part',
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


// --------------------------------------
// GET SUB NODE PART BY UUID
// --------------------------------------
router.get('/findbyid/:sub_node_parts_uuid', async (req, res) => {
    try {
        const result = await subnodePartsRequester.send({
            type                 : 'getById-sub-node-part',
            sub_node_parts_uuid  : req.params.sub_node_parts_uuid,
            body                 : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'getById-sub-node-part',
                method    : 'GET',
                payload   : { sub_node_parts_uuid: req.params.sub_node_parts_uuid },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'getById-sub-node-part',
            method    : 'GET',
            payload   : { sub_node_parts_uuid: req.params.sub_node_parts_uuid },
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
// UPDATE SUB NODE PART
// --------------------------------------
router.post('/update/:sub_node_parts_uuid', async (req, res) => {
    try {
        const result = await subnodePartsRequester.send({
            type                : 'update-sub-node-part',
            sub_node_parts_uuid : req.params.sub_node_parts_uuid,
            body                : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'update-sub-node-part',
                method    : 'POST',
                payload   : { sub_node_parts_uuid: req.params.sub_node_parts_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'update-sub-node-part',
            method    : 'POST',
            payload   : { sub_node_parts_uuid: req.params.sub_node_parts_uuid, ...req.body },
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
// DELETE SUB NODE PART
// --------------------------------------
router.post('/delete/:sub_node_parts_uuid', async (req, res) => {
    try {
        const result = await subnodePartsRequester.send({
            type                : 'delete-sub-node-part',
            sub_node_parts_uuid : req.params.sub_node_parts_uuid,
            body                : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'delete-sub-node-part',
                method    : 'POST',
                payload   : { sub_node_parts_uuid: req.params.sub_node_parts_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'delete-sub-node-part',
            method    : 'POST',
            payload   : { sub_node_parts_uuid: req.params.sub_node_parts_uuid, ...req.body },
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
// UNLOCK SUB NODE PART RECORD
// --------------------------------------
router.post('/unlock/:sub_node_parts_uuid', async (req, res) => {
    try {
        const result = await subnodePartsRequester.send({
            type                : 'unlock-sub-node-part',
            sub_node_parts_uuid : req.params.sub_node_parts_uuid,
            body                : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'unlock-sub-node-part',
                method    : 'POST',
                payload   : { sub_node_parts_uuid: req.params.sub_node_parts_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'unlock-sub-node-part',
            method    : 'POST',
            payload   : { sub_node_parts_uuid: req.params.sub_node_parts_uuid, ...req.body },
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
// ADVANCE FILTER LIST — SUB NODE PARTS
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await subnodePartsRequester.send({
            type: 'advancefilter-sub-node-parts',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'advancefilter-sub-node-parts',
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
            api_name  : 'advancefilter-sub-node-parts',
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


// --------------------------------------
// STATUS TOGGLE 
// --------------------------------------
router.post('/status/:sub_node_parts_uuid', async (req, res) => {
    try {
        const result = await subnodePartsRequester.send({
            type              : 'status-sub-node-parts',
            sub_node_parts_uuid: req.params.sub_node_parts_uuid,
            body              : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'status-sub-node-parts',
                method    : 'POST',
                payload   : {
                    sub_node_parts_uuid: req.params.sub_node_parts_uuid,
                    ...req.body
                },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });

            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {

        await saveErrorLog({
            api_name  : 'status-sub-node-parts',
            method    : 'POST',
            payload   : {
                sub_node_parts_uuid: req.params.sub_node_parts_uuid,
                ...req.body
            },
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

