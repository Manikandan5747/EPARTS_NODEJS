require('module-alias/register');

const express = require('express');
const router = express.Router();
const moduleRequester = require('@libs/requesters/admin-requesters/module-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


// --------------------------------------
// CREATE MODULE
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await moduleRequester.send({
            type: 'create-module',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-module',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(201).json(result);

    } catch (err) {
        logger.error("Error in modules/create:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// LIST ALL MODULES
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await moduleRequester.send({
            type: 'list-module'
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-module',
                method: 'GET',
                payload: null,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error("Error in modules/list:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// FIND MODULE BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await moduleRequester.send({
            type: 'getById-module',
            module_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-module',
                method: 'GET',
                payload: { module_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error("Error in modules/findbyid:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// UPDATE MODULE
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await moduleRequester.send({
            type: 'update-module',
            module_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-module',
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
        logger.error("Error in modules/update:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// DELETE MODULE
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await moduleRequester.send({
            type: 'delete-module',
            module_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-module',
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
        logger.error("Error in modules/delete:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// STATUS CHANGE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await moduleRequester.send({
            type: 'status-module',
            module_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-module',
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
        logger.error("Error in modules/status:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// ADVANCE FILTER + PAGINATION
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await moduleRequester.send({
            type: 'advancefilter-module',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-module',
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
        logger.error("Error in modules/pagination:", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
