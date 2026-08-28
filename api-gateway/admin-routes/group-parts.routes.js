const express = require('express');
const router = express.Router();
const groupPartsRequester = require('@libs/requesters/admin-requesters/group-parts-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


// --------------------------------------
// CREATE GROUP PART
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await groupPartsRequester.send({
            type: 'create-group-part',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'create-group-part',
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
        logger.error("Error in group-part/create:", err.message);
        await saveErrorLog({
            api_name  : 'create-group-part',
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
// GET GROUP PART BY UUID
// --------------------------------------
router.get('/findbyid/:group_parts_uuid', async (req, res) => {
    try {
        const result = await groupPartsRequester.send({
            type             : 'getById-group-part',
            group_parts_uuid : req.params.group_parts_uuid,
            body             : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'getById-group-part',
                method    : 'GET',
                payload   : { group_parts_uuid: req.params.group_parts_uuid },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'getById-group-part',
            method    : 'GET',
            payload   : { group_parts_uuid: req.params.group_parts_uuid },
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
// UPDATE GROUP PART
// --------------------------------------
router.post('/update/:group_parts_uuid', async (req, res) => {
    try {
        const result = await groupPartsRequester.send({
            type             : 'update-group-part',
            group_parts_uuid : req.params.group_parts_uuid,
            body             : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'update-group-part',
                method    : 'POST',
                payload   : { group_parts_uuid: req.params.group_parts_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'update-group-part',
            method    : 'POST',
            payload   : { group_parts_uuid: req.params.group_parts_uuid, ...req.body },
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
// DELETE GROUP PART
// --------------------------------------
router.post('/delete/:group_parts_uuid', async (req, res) => {
    try {
        const result = await groupPartsRequester.send({
            type             : 'delete-group-part',
            group_parts_uuid : req.params.group_parts_uuid,
            body             : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'delete-group-part',
                method    : 'POST',
                payload   : { group_parts_uuid: req.params.group_parts_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'delete-group-part',
            method    : 'POST',
            payload   : { group_parts_uuid: req.params.group_parts_uuid, ...req.body },
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
// UNLOCK GROUP PART RECORD
// --------------------------------------
router.post('/unlock/:group_parts_uuid', async (req, res) => {
    try {
        const result = await groupPartsRequester.send({
            type             : 'unlock-group-part',
            group_parts_uuid : req.params.group_parts_uuid,
            body             : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'unlock-group-part',
                method    : 'POST',
                payload   : { group_parts_uuid: req.params.group_parts_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'unlock-group-part',
            method    : 'POST',
            payload   : { group_parts_uuid: req.params.group_parts_uuid, ...req.body },
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
// ADVANCE FILTER LIST — GROUP PARTS
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await groupPartsRequester.send({
            type: 'advancefilter-group-parts',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'advancefilter-group-parts',
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
            api_name  : 'advancefilter-group-parts',
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
router.post('/status/:group_parts_uuid', async (req, res) => {
    try {
        const result = await groupPartsRequester.send({
            type           : 'status-group-parts',
            group_parts_uuid: req.params.group_parts_uuid,
            body           : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'status-group-parts',
                method    : 'POST',
                payload   : {
                    group_parts_uuid: req.params.group_parts_uuid,
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
            api_name  : 'status-group-parts',
            method    : 'POST',
            payload   : {
                group_parts_uuid: req.params.group_parts_uuid,
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

