require('module-alias/register');

const express = require('express');
const router = express.Router();
const tradingTypeRequester = require('@libs/requesters/admin-requesters/tradingType-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');

// --------------------------------------
// CREATE TRADING TYPE
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await tradingTypeRequester.send({
            type: 'create-trading-type',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-trading-type',
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
        logger.error('Error in trading-type/create:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// LIST TRADING TYPES
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await tradingTypeRequester.send({
            type: 'list-trading-type'
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-trading-type',
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
        logger.error('Error in trading-type/list:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// FIND BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await tradingTypeRequester.send({
            type: 'getById-trading-type',
            trading_type_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-trading-type',
                method: 'GET',
                payload: { trading_type_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error('Error in trading-type/findbyid:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// UPDATE TRADING TYPE
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await tradingTypeRequester.send({
            type: 'update-trading-type',
            trading_type_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-trading-type',
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
        logger.error('Error in trading-type/update:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// DELETE TRADING TYPE
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await tradingTypeRequester.send({
            type: 'delete-trading-type',
            trading_type_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-trading-type',
                method: 'POST',
                payload: { trading_type_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error('Error in trading-type/delete:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// STATUS CHANGE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await tradingTypeRequester.send({
            type: 'status-trading-type',
            trading_type_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-trading-type',
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
        logger.error('Error in trading-type/status:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// ADVANCE FILTER
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await tradingTypeRequester.send({
            type: 'advancefilter-trading-type',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-trading-type',
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
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
