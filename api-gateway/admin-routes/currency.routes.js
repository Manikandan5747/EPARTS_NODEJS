require('module-alias/register');

const express = require('express');
const router = express.Router();
const currencyRequester = require('@libs/requesters/admin-requesters/currency-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');

// --------------------------------------
// CREATE CURRENCY
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await currencyRequester.send({
            type: 'create-currency',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-currency',
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
        logger.error('Error in currency/create:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// LIST CURRENCY
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await currencyRequester.send({ type: 'list-currency' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-currency',
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
        logger.error('Error in currency/list:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// FIND BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await currencyRequester.send({
            type: 'getById-currency',
            currency_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-currency',
                method: 'GET',
                payload: { currency_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error('Error in currency/findbyid:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// UPDATE CURRENCY
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await currencyRequester.send({
            type: 'update-currency',
            currency_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-currency',
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
        logger.error('Error in currency/update:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// DELETE CURRENCY
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await currencyRequester.send({
            type: 'delete-currency',
            currency_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-currency',
                method: 'POST',
                payload: { currency_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error('Error in currency/delete:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// STATUS CHANGE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await currencyRequester.send({
            type: 'status-currency',
            currency_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-currency',
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
        logger.error('Error in currency/status:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// ADVANCE FILTER
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await currencyRequester.send({
            type: 'advancefilter-currency',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-currency',
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
