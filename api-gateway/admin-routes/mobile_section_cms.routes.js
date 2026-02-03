require('module-alias/register');

const express = require('express');
const router = express.Router();
const mobileSectionCmsRequester = require('@libs/requesters/admin-requesters/mobile_section_cms-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
//test
const uploadDir = path.join('/app/assets', 'mobile-section-cms');
const multipartMiddleware = multipart({ uploadDir });

// --------------------------------------
// CREATE MOBILE SECTION CMS
// --------------------------------------
router.post('/create', multipartMiddleware, async (req, res) => {
    try {
        // FILE
        const mobileSectionImage = req.files?.image?.path || null;

        const result = await mobileSectionCmsRequester.send({
            type: 'create-mobilesectioncms',
            body: {
                ...req.body,
                image: mobileSectionImage
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-mobilesectioncms',
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
        logger.error('Error in mobilesectioncms/create:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// LIST ALL MOBILE SECTION CMS
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await mobileSectionCmsRequester.send({ type: 'list-mobilesectioncms' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-mobilesectioncms',
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
        logger.error('Error in mobilesectioncms/list:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// FIND MOBILE SECTION CMS BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await mobileSectionCmsRequester.send({
            type: 'getById-mobilesectioncms',
        mobile_section_cms_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-mobilesectioncms',
                method: 'GET',
                payload: { mobile_section_cms_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in mobilesectioncms/findbyid:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// UPDATE MOBILE SECTION CMS
// --------------------------------------
router.post('/update/:id', multipartMiddleware, async (req, res) => {
    try {
        // FILE (optional)
        const mobileSectionImage = req.files?.image?.path || null;
        const result = await mobileSectionCmsRequester.send({
            type: 'update-mobilesectioncms',
            mobile_section_cms_uuid: req.params.id,
            body: {
                ...req.body,
                mobile_section_cms_uuid: req.params.id,
                image: mobileSectionImage   
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-mobilesectioncms',
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
        logger.error('Error in mobilesectioncms/update:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// DELETE MOBILE SECTION CMS
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await mobileSectionCmsRequester.send({
            type: 'delete-mobilesectioncms',
            mobile_section_cms_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-mobilesectioncms',
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
        logger.error('Error in mobilesectioncms/delete:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// STATUS CHANGE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await mobileSectionCmsRequester.send({
            type: 'status-mobilesectioncms',
            mobile_section_cms_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-mobilesectioncms',
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
        logger.error('Error in mobilesectioncms/status:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------
// ADVANCE FILTER LIST API
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await mobileSectionCmsRequester.send({
            type: 'advancefilter-mobilesectioncms',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-mobilesectioncms',
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
        logger.error('Error in mobilesectioncms/pagination-list:', err.message);
        res.status(500).json({ error: err.message });
    }
});





// --------------------------------------
// MOBILE SECTION CMS LIST (SEARCH + PAGINATION)
// --------------------------------------
router.get("/listpagination", async (req, res) => {
    try {
        const {
            search = "",
            page = 1,
            limit = 10
        } = req.query;

        const result = await mobileSectionCmsRequester.send({
            type: "mobilesectioncms-list",
            search,
            page: Number(page),
            limit: Number(limit)
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: "mobilesectioncms-list",
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
        logger.error("Error in /mobilesectioncms/listpagination:", err);
        return res.status(500).json({
            status: false,
            code: 2004,
            error: err.message
        });
    }
});

module.exports = router;
