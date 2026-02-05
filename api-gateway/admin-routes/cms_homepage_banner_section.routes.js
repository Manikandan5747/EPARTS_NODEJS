require('module-alias/register');

const express = require('express');
const router = express.Router();
const cmsHomepageBannerSectionRequester = require('@libs/requesters/admin-requesters/cms_homepage_banner_section-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
//test
const uploadDir = path.join('/app/assets', 'cms-homepage-banner-section');
const multipartMiddleware = multipart({ uploadDir });

// --------------------------------------
// CREATE
// --------------------------------------
router.post('/create', multipartMiddleware, async (req, res) => {
    try {
        // FILE
        const cmsHomepageBannerSectionImage = req.files?.image?.path || null;
        const cmsHomepageBannerSectionVideo = req.files?.filetype?.path || null;

        const result = await cmsHomepageBannerSectionRequester.send({
            type: 'create-cmshomepagebannersection',
            body: {
                ...req.body,
                image:cmsHomepageBannerSectionImage,
                filetype:cmsHomepageBannerSectionVideo

            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-cmshomepagebannersection',
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
        logger.error('Error in cmshomepagebannersection/create:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// LIST ALL 
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await cmsHomepageBannerSectionRequester.send({ type: 'list-cmshomepagebannersection' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-cmshomepagebannersection',
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
        logger.error('Error in cmshomepagebannersection/list:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// FIND BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await cmsHomepageBannerSectionRequester.send({
            type: 'getById-cmshomepagebannersection',
        banner_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-cmshomepagebannersection',
                method: 'GET',
                payload: { banner_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in cmshomepagebannersection/findbyid:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// UPDATE 
// --------------------------------------
router.post('/update/:id', multipartMiddleware, async (req, res) => {
    try {
        // FILE (optional)
        const cmsHomepageBannerSectionImage = req.files?.image?.path || null;
        const cmsHomepageBannerSectionVideo = req.files?.filetype?.path || null;

        const result = await cmsHomepageBannerSectionRequester.send({
            type: 'update-cmshomepagebannersection',
            banner_uuid: req.params.id,
            body: {
                ...req.body,
                banner_uuid: req.params.id,
                image: cmsHomepageBannerSectionImage ,
                filetype:cmsHomepageBannerSectionVideo  
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-cmshomepagebannersection',
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
        logger.error('Error in cmshomepagebannersection/update:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// DELETE 
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await cmsHomepageBannerSectionRequester.send({
            type: 'delete-cmshomepagebannersection',
            banner_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-cmshomepagebannersection',
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
        logger.error('Error in cmshomepagebannersection/delete:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// STATUS CHANGE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await cmsHomepageBannerSectionRequester.send({
            type: 'status-cmshomepagebannersection',
            banner_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-cmshomepagebannersection',
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
        logger.error('Error in cmshomepagebannersection/status:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// ADVANCE FILTER LIST API
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await cmsHomepageBannerSectionRequester.send({
            type: 'advancefilter-cmshomepagebannersection',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-cmshomepagebannersection',
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
        logger.error('Error in cmshomepagebannersection/pagination-list:', err.message);
        res.status(500).json({ error: err.message });
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

        const result = await cmsHomepageBannerSectionRequester.send({
            type: "cmshomepagebannersection-list",
            search,
            page: Number(page),
            limit: Number(limit)
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: "cmshomepagebannersection-list",
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
        logger.error("Error in /cmshomepagebannersection/listpagination:", err);
        return res.status(500).json({
            status: false,
            code: 2004,
            error: err.message
        });
    }
});

module.exports = router;
