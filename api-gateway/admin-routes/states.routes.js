require('module-alias/register');

const express = require('express');
const router = express.Router();
const stateRequester = require('@libs/requesters/admin-requesters/states-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');

// --------------------------------------
// CREATE STATE
// --------------------------------------
router.post('/create',async (req, res) => {
    try {
      
        const result = await stateRequester.send({
            type: 'create-state',
             body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-state',
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
        logger.error('Error in states/create:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// LIST ALL STATES
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await stateRequester.send({ type: 'list-state' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-state',
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
        logger.error('Error in states/list:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// FIND STATE BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await stateRequester.send({
            type: 'getById-state',
            state_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-state',
                method: 'GET',
                payload: { state_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in states/findbyid:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// UPDATE STATE
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await stateRequester.send({
            type: 'update-state',
            state_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-state',
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
        logger.error('Error in states/update:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// DELETE STATE
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await stateRequester.send({
            type: 'delete-state',
            state_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-state',
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
        logger.error('Error in states/delete:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// STATUS CHANGE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await stateRequester.send({
            type: 'status-state',
            state_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-state',
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
        logger.error('Error in states/status:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// ADVANCE FILTER LIST API
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await stateRequester.send({
            type: 'advancefilter-state',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-state',
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
        logger.error('Error in states/pagination-list:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// CLONE STATE
// --------------------------------------
router.post('/clone/:id', async (req, res) => {
    try {
        const result = await stateRequester.send({
            type: 'clone-state',
            state_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'clone-state',
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
        logger.error('Error in states/clone:', err.message);
        res.status(500).json({ error: err.message });
    }
});



// --------------------------------------
// FIND COUNTRY_ID BY ID
// --------------------------------------
router.get('/countryid/:id', async (req, res) => {
    try {
        const result = await stateRequester.send({
            type: 'getById-countryid',
            country_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-countryid',
                method: 'GET',
                payload: { country_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in states countryid/findbyid:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;