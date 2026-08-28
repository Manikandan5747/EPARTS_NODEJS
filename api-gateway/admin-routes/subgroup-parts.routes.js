const express = require('express');
const router = express.Router();
const subgroupPartsRequester = require('@libs/requesters/admin-requesters/subgroup-parts-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


// --------------------------------------
// CREATE SUB GROUP PART
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await subgroupPartsRequester.send({
            type: 'create-sub-group-part',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'create-sub-group-part',
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
        logger.error("Error in sub-group-part/create:", err.message);
        await saveErrorLog({
            api_name  : 'create-sub-group-part',
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
// GET SUB GROUP PART BY UUID
// --------------------------------------
router.get('/findbyid/:sub_group_parts_uuid', async (req, res) => {
    try {
        const result = await subgroupPartsRequester.send({
            type                  : 'getById-sub-group-part',
            sub_group_parts_uuid  : req.params.sub_group_parts_uuid,
            body                  : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'getById-sub-group-part',
                method    : 'GET',
                payload   : { sub_group_parts_uuid: req.params.sub_group_parts_uuid },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'getById-sub-group-part',
            method    : 'GET',
            payload   : { sub_group_parts_uuid: req.params.sub_group_parts_uuid },
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
// UPDATE SUB GROUP PART
// --------------------------------------
router.post('/update/:sub_group_parts_uuid', async (req, res) => {
    try {
        const result = await subgroupPartsRequester.send({
            type                 : 'update-sub-group-part',
            sub_group_parts_uuid : req.params.sub_group_parts_uuid,
            body                 : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'update-sub-group-part',
                method    : 'POST',
                payload   : { sub_group_parts_uuid: req.params.sub_group_parts_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'update-sub-group-part',
            method    : 'POST',
            payload   : { sub_group_parts_uuid: req.params.sub_group_parts_uuid, ...req.body },
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
// DELETE SUB GROUP PART
// --------------------------------------
router.post('/delete/:sub_group_parts_uuid', async (req, res) => {
    try {
        const result = await subgroupPartsRequester.send({
            type                 : 'delete-sub-group-part',
            sub_group_parts_uuid : req.params.sub_group_parts_uuid,
            body                 : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'delete-sub-group-part',
                method    : 'POST',
                payload   : { sub_group_parts_uuid: req.params.sub_group_parts_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'delete-sub-group-part',
            method    : 'POST',
            payload   : { sub_group_parts_uuid: req.params.sub_group_parts_uuid, ...req.body },
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
// UNLOCK SUB GROUP PART RECORD
// --------------------------------------
router.post('/unlock/:sub_group_parts_uuid', async (req, res) => {
    try {
        const result = await subgroupPartsRequester.send({
            type                 : 'unlock-sub-group-part',
            sub_group_parts_uuid : req.params.sub_group_parts_uuid,
            body                 : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'unlock-sub-group-part',
                method    : 'POST',
                payload   : { sub_group_parts_uuid: req.params.sub_group_parts_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'unlock-sub-group-part',
            method    : 'POST',
            payload   : { sub_group_parts_uuid: req.params.sub_group_parts_uuid, ...req.body },
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
// ADVANCE FILTER LIST — SUB GROUP PARTS
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await subgroupPartsRequester.send({
            type: 'advancefilter-sub-group-parts',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'advancefilter-sub-group-parts',
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
            api_name  : 'advancefilter-sub-group-parts',
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
router.post('/status/:sub_group_parts_uuid', async (req, res) => {
    try {
        const result = await subgroupPartsRequester.send({
            type               : 'status-sub-group-parts',
            sub_group_parts_uuid: req.params.sub_group_parts_uuid,
            body               : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'status-sub-group-parts',
                method    : 'POST',
                payload   : {
                    sub_group_parts_uuid: req.params.sub_group_parts_uuid,
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
            api_name  : 'status-sub-group-parts',
            method    : 'POST',
            payload   : {
                sub_group_parts_uuid: req.params.sub_group_parts_uuid,
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

