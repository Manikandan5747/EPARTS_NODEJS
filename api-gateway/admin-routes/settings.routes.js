require('module-alias/register');

const express = require('express');
const router = express.Router();
const settingsRequester = require('@libs/requesters/admin-requesters/settings-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


// --------------------------------------
// CREATE SETTING
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await settingsRequester.send({
            type: 'create-setting',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-setting',
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
        logger.error('Error in settings/create:', err.message);
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
// LIST SETTINGS
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await settingsRequester.send({ type: 'list-setting' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-setting',
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
        logger.error('Error in settings/list:', err.message);
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
// FIND SETTING BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await settingsRequester.send({
            type: 'getById-setting',
            setting_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-setting',
                method: 'GET',
                payload: { setting_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error('Error in settings/findbyid:', err.message);
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
// UPDATE SETTING
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await settingsRequester.send({
            type: 'update-setting',
            setting_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-setting',
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
        logger.error('Error in settings/update:', err.message);
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
// DELETE SETTING (SOFT DELETE)
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await settingsRequester.send({
            type: 'delete-setting',
            setting_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-setting',
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
        logger.error('Error in settings/delete:', err.message);
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
// STATUS CHANGE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await settingsRequester.send({
            type: 'status-setting',
            setting_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-setting',
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
        logger.error('Error in settings/status:', err.message);
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
// ADVANCE FILTER LIST
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await settingsRequester.send({
            type: 'advancefilter-setting',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-setting',
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
        logger.error('Error in settings/pagination-list:', err.message);
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
// FIND SETTING CATEGORY BY NAME
// --------------------------------------
router.get('/setcategory/:id', async (req, res) => {
    try {
        const result = await settingsRequester.send({
            type: 'setcategory-setting',
            setcategory: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'setcategory-setting',
                method: 'GET',
                payload: { setcategory: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error('Error in settings/setcategory:', err.message);
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

module.exports = router;
