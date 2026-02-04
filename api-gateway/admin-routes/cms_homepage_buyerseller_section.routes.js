require('module-alias/register');

const express = require('express');
const router = express.Router();
const cmsHomepageBuyerSellerSectionRequester = require('@libs/requesters/admin-requesters/cms_homepage_buyerseller_section-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
//test
const uploadDir = path.join('/app/assets', 'cms-homepage-buyerseller-section');
const multipartMiddleware = multipart({ uploadDir });

// --------------------------------------
// CREATE
// --------------------------------------
router.post('/create', multipartMiddleware, async (req, res) => {
    try {
        // FILE
        const cmsHomepageBuyerImage = req.files?.buyer_image?.path || null;
        const cmsHomepageSellerImage = req.files?.seller_image?.path || null;

        const result = await cmsHomepageBuyerSellerSectionRequester.send({
            type: 'create-cmshomepagebuyersellersection',
            body: {
                ...req.body,
                buyer_image:cmsHomepageBuyerImage,
                seller_image:cmsHomepageSellerImage
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-cmshomepagebuyersellersection',
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
        logger.error('Error in cmshomepagebuyersellersection/create:', err.message);
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
        const result = await cmsHomepageBuyerSellerSectionRequester.send({ type: 'list-cmshomepagebuyersellersection' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-cmshomepagebuyersellersection',
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
        logger.error('Error in cmshomepagebuyersellersection/list:', err.message);
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
        const result = await cmsHomepageBuyerSellerSectionRequester.send({
            type: 'getById-cmshomepagebuyersellersection',
        buyerseller_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-cmshomepagebuyersellersection',
                method: 'GET',
                payload: { buyerseller_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in cmshomepagebuyersellersection/findbyid:', err.message);
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
        const cmsHomepageBuyerImage = req.files?.buyer_image?.path || null;
        const cmsHomepageSellerImage = req.files?.seller_image?.path || null;

        const result = await cmsHomepageBuyerSellerSectionRequester.send({
            type: 'update-cmshomepagebuyersellersection',
            buyerseller_uuid: req.params.id,
            body: {
                ...req.body,
                buyerseller_uuid: req.params.id,
                buyer_image: cmsHomepageBuyerImage,
                seller_image: cmsHomepageSellerImage   
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-cmshomepagebuyersellersection',
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
        logger.error('Error in cmshomepagebuyersellersection/update:', err.message);
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
        const result = await cmsHomepageBuyerSellerSectionRequester.send({
            type: 'delete-cmshomepagebuyersellersection',
            buyerseller_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-cmshomepagebuyersellersection',
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
        logger.error('Error in cmshomepagebuyersellersection/delete:', err.message);
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
        const result = await cmsHomepageBuyerSellerSectionRequester.send({
            type: 'status-cmshomepagebuyersellersection',
            buyerseller_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-cmshomepagebuyersellersection',
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
        logger.error('Error in cmshomepagebuyersellersection/status:', err.message);
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
        const result = await cmsHomepageBuyerSellerSectionRequester.send({
            type: 'advancefilter-cmshomepagebuyersellersection',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-cmshomepagebuyersellersection',
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
        logger.error('Error in cmshomepagebuyersellersection/pagination-list:', err.message);
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

        const result = await cmsHomepageBuyerSellerSectionRequester.send({
            type: "cmshomepagebuyersellersection-list",
            search,
            page: Number(page),
            limit: Number(limit)
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: "cmshomepagebuyersellersection-list",
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
        logger.error("Error in /cmshomepagebuyersellersection/listpagination:", err);
        return res.status(500).json({
            status: false,
            code: 2004,
            error: err.message
        });
    }
});

module.exports = router;
