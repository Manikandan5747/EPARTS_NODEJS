require('module-alias/register');

const express = require('express');
const router = express.Router();
const cmsHomepageFeaturesRequester = require('@libs/requesters/admin-requesters/cms_homepage_features_section-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
//test
const uploadDir = path.join('/app/assets', 'cms-homepage-features');
const multipartMiddleware = multipart({ uploadDir });

// --------------------------------------
// CREATE
// --------------------------------------
router.post('/create', multipartMiddleware, async (req, res) => {
    try {
        // FILE
        const cmsHomepageFeaturesImage = req.files?.icon?.path || null;

        const result = await cmsHomepageFeaturesRequester.send({
            type: 'create-cmshomepagefeatures',
            body: {
                ...req.body,
                icon:cmsHomepageFeaturesImage
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-cmshomepagefeatures',
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
        logger.error('Error in cmshomepagefeatures/create:', err.message);
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
        const result = await cmsHomepageFeaturesRequester.send({ type: 'list-cmshomepagefeatures' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-cmshomepagefeatures',
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
        logger.error('Error in cmshomepagefeatures/list:', err.message);
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
        const result = await cmsHomepageFeaturesRequester.send({
            type: 'getById-cmshomepagefeatures',
        cms_features_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-cmshomepagefeatures',
                method: 'GET',
                payload: { cms_features_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in cmshomepagefeatures/findbyid:', err.message);
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
        const cmsHomepageFeaturesImage = req.files?.icon?.path || null;
        const result = await cmsHomepageFeaturesRequester.send({
            type: 'update-cmshomepagefeatures',
            cms_features_uuid: req.params.id,
            body: {
                ...req.body,
                cms_features_uuid: req.params.id,
                icon: cmsHomepageFeaturesImage   
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-cmshomepagefeatures',
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
        logger.error('Error in cmshomepagefeatures/update:', err.message);
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
        const result = await cmsHomepageFeaturesRequester.send({
            type: 'delete-cmshomepagefeatures',
            cms_features_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-cmshomepagefeatures',
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
        logger.error('Error in cmshomepagefeatures/delete:', err.message);
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
        const result = await cmsHomepageFeaturesRequester.send({
            type: 'status-cmshomepagefeatures',
            cms_features_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-cmshomepagefeatures',
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
        logger.error('Error in cmshomepagefeatures/status:', err.message);
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
        const result = await cmsHomepageFeaturesRequester.send({
            type: 'advancefilter-cmshomepagefeatures',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-cmshomepagefeatures',
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
        logger.error('Error in cmshomepagefeatures/pagination-list:', err.message);
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

        const result = await cmsHomepageFeaturesRequester.send({
            type: "cmshomepagefeatures-list",
            search,
            page: Number(page),
            limit: Number(limit)
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: "cmshomepagefeatures-list",
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
        logger.error("Error in /cmshomepagefeatures/listpagination:", err);
        return res.status(500).json({
            status: false,
            code: 2004,
            error: err.message
        });
    }
});

module.exports = router;
