require('module-alias/register');

const express = require('express');
const router = express.Router();
const brandRequester = require('@libs/requesters/admin-requesters/brand-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
//test
const uploadDir = path.join('/app/assets', 'brands');
const multipartMiddleware = multipart({ uploadDir });

// --------------------------------------
// CREATE BRAND
// --------------------------------------
router.post('/create', multipartMiddleware, async (req, res) => {
    try {
        // FILE
        const flagIconPath = req.files?.flag_icon_path?.path || null;

        const result = await brandRequester.send({
            type: 'create-brand',
            body: {
                ...req.body,
                flag_icon_path: flagIconPath
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-brand',
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
        logger.error('Error in brands/create:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// LIST ALL BRANDS
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await brandRequester.send({ type: 'list-brand' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-brand',
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
        logger.error('Error in brands/list:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// FIND BRAND BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await brandRequester.send({
            type: 'getById-brand',
            brand_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-brand',
                method: 'GET',
                payload: { brand_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in brands/findbyid:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// UPDATE BRAND
// --------------------------------------
router.post('/update/:id', multipartMiddleware, async (req, res) => {
    try {
        // FILE (optional)
        const flagIconPath = req.files?.flag_icon?.path || null;
        const result = await brandRequester.send({
            type: 'update-brand',
            brand_uuid: req.params.id,
            body: {
                ...req.body,
                brand_uuid: req.params.id,
                flag_icon_path: flagIconPath   // ✅ pass only if exists
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-brand',
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
        logger.error('Error in brands/update:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// DELETE BRAND
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await brandRequester.send({
            type: 'delete-brand',
            brand_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-brand',
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
        logger.error('Error in brands/delete:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// STATUS CHANGE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await brandRequester.send({
            type: 'status-brand',
            brand_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-brand',
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
        logger.error('Error in brands/status:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// ADVANCE FILTER LIST API
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await brandRequester.send({
            type: 'advancefilter-brand',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-brand',
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
        logger.error('Error in brands/pagination-list:', err.message);
        res.status(500).json({ error: err.message });
    }
});





// --------------------------------------
// BRAND LIST (SEARCH + PAGINATION)
// --------------------------------------
router.get("/listpagination", async (req, res) => {
    try {
        const {
            search = "",
            page = 1,
            limit = 10
        } = req.query;

        const result = await brandRequester.send({
            type: "brand-list",
            search,
            page: Number(page),
            limit: Number(limit)
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: "brand-list",
                method: "GET",
                payload: { search, page, limit },
                message: result.error,
                stack: result.stack || "",
                error_code: result.code || 2004
            });

            return res.status(500).json(result);
        }

        return res.status(200).json(result);

    } catch (err) {
        logger.error("Error in /brand/listpagination:", err);
        return res.status(500).json({
            status: false,
            code: 2004,
            error: err.message
        });
    }
});

module.exports = router;
