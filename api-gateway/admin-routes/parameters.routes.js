require('module-alias/register');

const express = require('express');
const router = express.Router();
const parametersRequester = require('@libs/requesters/admin-requesters/parameters-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


// --------------------------------------
// CREATE PARAMETER 
// --------------------------------------

router.post('/create', async (req, res) => {
    try {
        const result = await parametersRequester.send({
            type: 'create-parameter',
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'create-parameter',
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
        logger.error("Error in parameter/create:", err.message);
        await saveErrorLog({
            api_name  : 'create-parameter',
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
// GET PARAMETER BY UUID 
// --------------------------------------
router.get('/findbyid/:parameter_uuid', async (req, res) => {
    try {
        const result = await parametersRequester.send({
            type        : 'getById-parameter',
            parameter_uuid: req.params.parameter_uuid,
            body        : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'getById-parameter',
                method    : 'GET',
                payload   : { parameter_uuid: req.params.parameter_uuid },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'getById-parameter',
            method    : 'GET',
            payload   : { parameter_uuid: req.params.parameter_uuid },
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
// UPDATE PARAMETER
// --------------------------------------
router.post('/update/:parameter_uuid', async (req, res) => {
    try {
        const result = await parametersRequester.send({
            type        : 'update-parameter',
            parameter_uuid: req.params.parameter_uuid,
            body        : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'update-parameter',
                method    : 'post',
                payload   : { parameter_uuid: req.params.parameter_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'update-parameter',
            method    : 'post',
            payload   : { parameter_uuid: req.params.parameter_uuid, ...req.body },
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
// DELETE PARAMETER
// --------------------------------------
router.post('/delete/:parameter_uuid', async (req, res) => {
    try {
        const result = await parametersRequester.send({
            type        : 'delete-parameter',
            parameter_uuid: req.params.parameter_uuid,
            body        : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'delete-parameter',
                method    : 'DELETE',
                payload   : { parameter_uuid: req.params.parameter_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'delete-parameter',
            method    : 'DELETE',
            payload   : { parameter_uuid: req.params.parameter_uuid, ...req.body },
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
// STATUS TOGGLE — PARAMETER
// --------------------------------------
router.post('/status/:parameter_uuid', async (req, res) => {
    try {
        const result = await parametersRequester.send({
            type        : 'status-parameter',
            parameter_uuid: req.params.parameter_uuid,
            body        : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'status-parameter',
                method    : 'POST',
                payload   : { parameter_uuid: req.params.parameter_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'status-parameter',
            method    : 'POST',
            payload   : { parameter_uuid: req.params.parameter_uuid, ...req.body },
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
// UNLOCK PARAMETER RECORD
// --------------------------------------
router.post('/unlock/:parameter_uuid', async (req, res) => {
    try {
        const result = await parametersRequester.send({
            type        : 'unlock-parameter',
            parameter_uuid: req.params.parameter_uuid,
            body        : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'unlock-parameter',
                method    : 'POST',
                payload   : { parameter_uuid: req.params.parameter_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'unlock-parameter',
            method    : 'POST',
            payload   : { parameter_uuid: req.params.parameter_uuid, ...req.body },
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
// ADVANCE FILTER LIST — PARAMETERS
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await parametersRequester.send({
            type: 'advancefilter-parameters',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'advancefilter-parameters',
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
            api_name  : 'advancefilter-parameters',
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
