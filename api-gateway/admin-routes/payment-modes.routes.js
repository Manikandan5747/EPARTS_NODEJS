require('module-alias/register');

const express = require('express');
const router = express.Router();
const paymentModeRequester = require('@libs/requesters/admin-requesters/payment-modes-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');

// --------------------------------------
// CREATE PAYMENT MODE
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await paymentModeRequester.send({
            type: 'create-payment-mode',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-payment-mode',
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
        logger.error('Error in payment-mode/create:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// LIST PAYMENT MODES
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await paymentModeRequester.send({
            type: 'list-payment-mode'
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-payment-mode',
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
        logger.error('Error in payment-mode/list:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// FIND BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await paymentModeRequester.send({
            type: 'getById-payment-mode',
            payment_mode_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-payment-mode',
                method: 'GET',
                payload: { payment_mode_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error('Error in payment-mode/findbyid:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// UPDATE PAYMENT MODE
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await paymentModeRequester.send({
            type: 'update-payment-mode',
            payment_mode_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-payment-mode',
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
        logger.error('Error in payment-mode/update:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// DELETE PAYMENT MODE
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await paymentModeRequester.send({
            type: 'delete-payment-mode',
            payment_mode_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-payment-mode',
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
        logger.error('Error in payment-mode/delete:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// STATUS CHANGE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await paymentModeRequester.send({
            type: 'status-payment-mode',
            payment_mode_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-payment-mode',
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
        logger.error('Error in payment-mode/status:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// ADVANCE FILTER
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await paymentModeRequester.send({
            type: 'advancefilter-payment-mode',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-payment-mode',
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
