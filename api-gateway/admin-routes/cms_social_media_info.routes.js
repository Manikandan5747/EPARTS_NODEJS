require('module-alias/register');

const express = require('express');
const router = express.Router();
const cmsSocialMediaInfoRequester = require('@libs/requesters/admin-requesters/cms_social_media_info-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
//test
const uploadDir = path.join('/app/assets', 'cms-social-media-info');
const multipartMiddleware = multipart({ uploadDir });

// --------------------------------------
// CREATE
// --------------------------------------
router.post('/create', multipartMiddleware, async (req, res) => {
    try {
        // FILE
        const cmsSocialMediaInfoImage = req.files?.icon?.path || null;

        const result = await cmsSocialMediaInfoRequester.send({
            type: 'create-cmssocialmediainfo',
            body: {
                ...req.body,
                icon: cmsSocialMediaInfoImage ? cmsSocialMediaInfoImage.replace(/\\/g, '/') : null,
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-cmssocialmediainfo',
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
        logger.error('Error in cmssocialmediainfo/create:', err.message);
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
// LIST ALL 
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await cmsSocialMediaInfoRequester.send({ type: 'list-cmssocialmediainfo' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-cmssocialmediainfo',
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
        logger.error('Error in cmssocialmediainfo/list:', err.message);
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
// FIND BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await cmsSocialMediaInfoRequester.send({
            type: 'getById-cmssocialmediainfo',
            social_media_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-cmssocialmediainfo',
                method: 'GET',
                payload: { social_media_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in cmssocialmediainfo/findbyid:', err.message);
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
// UPDATE 
// --------------------------------------
router.post('/update/:id', multipartMiddleware, async (req, res) => {
    try {
        // FILE (optional)
        const cmsSocialMediaInfoImage = req.files?.icon?.path || null;
        const result = await cmsSocialMediaInfoRequester.send({
            type: 'update-cmssocialmediainfo',
            social_media_uuid: req.params.id,
            body: {
                ...req.body,
                social_media_uuid: req.params.id,

                icon: cmsSocialMediaInfoImage ? cmsSocialMediaInfoImage.replace(/\\/g, '/') : null,
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-cmssocialmediainfo',
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
        logger.error('Error in cmssocialmediainfo/update:', err.message);
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
// DELETE 
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await cmsSocialMediaInfoRequester.send({
            type: 'delete-cmssocialmediainfo',
            social_media_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-cmssocialmediainfo',
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
        logger.error('Error in cmssocialmediainfo/delete:', err.message);
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
        const result = await cmsSocialMediaInfoRequester.send({
            type: 'status-cmssocialmediainfo',
            social_media_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-cmssocialmediainfo',
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
        logger.error('Error in cmssocialmediainfo/status:', err.message);
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
// ADVANCE FILTER LIST API
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await cmsSocialMediaInfoRequester.send({
            type: 'advancefilter-cmssocialmediainfo',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-cmssocialmediainfo',
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
        logger.error('Error in cmssocialmediainfo/pagination-list:', err.message);
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
// LIST (SEARCH + PAGINATION)
// --------------------------------------
router.get("/listpagination", async (req, res) => {
    try {
        const {
            search = "",
            page = 1,
            limit = 10
        } = req.query;

        const result = await cmsSocialMediaInfoRequester.send({
            type: "cmssocialmediainfo-list",
            search,
            page: Number(page),
            limit: Number(limit)
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: "cmssocialmediainfo-list",
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
        logger.error("Error in /cmssocialmediainfo/listpagination:", err);
        return res.status(500).json({
            status: false,
            code: 2004,
            error: err.message
        });
    }
});

module.exports = router;
