require('module-alias/register');

const express = require('express');
const router = express.Router();
const countryRequester = require('@libs/requesters/admin-requesters/countries-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');

// const uploadDir = path.join('/app/assets', 'countries');
// const multipartMiddleware = multipart({ uploadDir });


const fs = require('fs');

const uploadDir = 'C:/inetpub/wwwroot/EPARTS/PRODUCTION_FILES/countries_files';

// Create directory if missing
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const multipartMiddleware = multipart({ uploadDir });

// --------------------------------------
// CREATE COUNTRY
// --------------------------------------
router.post('/create', multipartMiddleware, async (req, res) => {
    try {
        // FILE
        const flagIconPath = req.files?.flag_icon_path?.path || null;

        const result = await countryRequester.send({
            type: 'create-country',
            body: {
                ...req.body,
                flag_icon_path: flagIconPath
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-country',
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
        logger.error('Error in countries/create:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// LIST ALL COUNTRIES
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await countryRequester.send({ type: 'list-country' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-country',
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
        logger.error('Error in countries/list:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// FIND COUNTRY BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await countryRequester.send({
            type: 'getById-country',
            country_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-country',
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
        logger.error('Error in countries/findbyid:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// UPDATE COUNTRY
// --------------------------------------
router.post('/update/:id', multipartMiddleware, async (req, res) => {
    try {
        // FILE (optional)
        const flagIconPath = req.files?.flag_icon?.path || null;
        const result = await countryRequester.send({
            type: 'update-country',
            country_uuid: req.params.id,
            body: {
                ...req.body,
                country_uuid: req.params.id,
                flag_icon_path: flagIconPath   // ✅ pass only if exists
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-country',
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
        logger.error('Error in countries/update:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// DELETE COUNTRY
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await countryRequester.send({
            type: 'delete-country',
            country_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-country',
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
        logger.error('Error in countries/delete:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// STATUS CHANGE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await countryRequester.send({
            type: 'status-country',
            country_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-country',
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
        logger.error('Error in countries/status:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// ADVANCE FILTER LIST API
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await countryRequester.send({
            type: 'advancefilter-country',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-country',
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
        logger.error('Error in countries/pagination-list:', err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// CLONE COUNTRY
// --------------------------------------
router.post('/clone/:id', async (req, res) => {
    try {
        const result = await stateRequester.send({
            type: 'clone-country',
            state_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'clone-country',
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
        logger.error('Error in country/clone:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
