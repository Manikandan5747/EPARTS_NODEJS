require('module-alias/register');

const express = require('express');
const router = express.Router();
const cmsCompanyInfoRequester = require('@libs/requesters/admin-requesters/cms_company_info-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
//test
const uploadDir = path.join('/app/assets', 'cms-company-info');
const multipartMiddleware = multipart({ uploadDir });

// --------------------------------------
// CREATE
// --------------------------------------
router.post('/create', multipartMiddleware, async (req, res) => {
    try {
        // FILE
        const cmsCompanyInfoLogo = req.files?.logo?.path || null;
        const cmsCompanyInfoFooterImage1 = req.files?.footer_image1?.path || null;
        const cmsCompanyInfoFooterImage2 = req.files?.footer_image2?.path || null;
        const cmsCompanyInfoFooterImage3 = req.files?.footer_image3?.path || null;
        const cmsCompanyInfoDynamicsImage = req.files?.dynamics_image?.path || null;

        const result = await cmsCompanyInfoRequester.send({
            type: 'create-cmscompanyinfo',
            body: {
                ...req.body,
                logo: cmsCompanyInfoLogo,
                footer_image1: cmsCompanyInfoFooterImage1,
                footer_image2: cmsCompanyInfoFooterImage2,
                footer_image3: cmsCompanyInfoFooterImage3,
                dynamics_image: cmsCompanyInfoDynamicsImage
            }

        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-cmscompanyinfo',
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
        logger.error('Error in cmscompanyinfo/create:', err.message);
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
        const result = await cmsCompanyInfoRequester.send({ type: 'list-cmscompanyinfo' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-cmscompanyinfo',
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
        logger.error('Error in cmscompanyinfo/list:', err.message);
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
        const result = await cmsCompanyInfoRequester.send({
            type: 'getById-cmscompanyinfo',
        cms_company_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-cmscompanyinfo',
                method: 'GET',
                payload: { cms_company_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in cmscompanyinfo/findbyid:', err.message);
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
        const cmsCompanyInfoLogo = req.files?.logo?.path || null;
        const cmsCompanyInfoFooterImage1 = req.files?.footer_image1?.path || null;
        const cmsCompanyInfoFooterImage2 = req.files?.footer_image2?.path || null;
        const cmsCompanyInfoFooterImage3 = req.files?.footer_image3?.path || null;
        const cmsCompanyInfoDynamicsImage = req.files?.dynamics_image?.path || null;

        const result = await cmsCompanyInfoRequester.send({
            type: 'update-cmscompanyinfo',
            cms_company_uuid: req.params.id,
            body: {
                ...req.body,
                cms_company_uuid: req.params.id,
               logo: cmsCompanyInfoLogo,
                footer_image1: cmsCompanyInfoFooterImage1,
                footer_image2: cmsCompanyInfoFooterImage2,
                footer_image3: cmsCompanyInfoFooterImage3,
                dynamics_image: cmsCompanyInfoDynamicsImage 
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-cmscompanyinfo',
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
        logger.error('Error in cmscompanyinfo/update:', err.message);
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
        const result = await cmsCompanyInfoRequester.send({
            type: 'delete-cmscompanyinfo',
            cms_company_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-cmscompanyinfo',
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
        logger.error('Error in cmscompanyinfo/delete:', err.message);
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
        const result = await cmsCompanyInfoRequester.send({
            type: 'status-cmscompanyinfo',
            cms_company_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-cmscompanyinfo',
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
        logger.error('Error in cmscompanyinfo/status:', err.message);
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
        const result = await cmsCompanyInfoRequester.send({
            type: 'advancefilter-cmscompanyinfo',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-cmscompanyinfo',
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
        logger.error('Error in cmscompanyinfo/pagination-list:', err.message);
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

        const result = await cmsCompanyInfoRequester.send({
            type: "cmscompanyinfo-list",
            search,
            page: Number(page),
            limit: Number(limit)
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: "cmscompanyinfo-list",
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
        logger.error("Error in /cmscompanyinfo/listpagination:", err);
        return res.status(500).json({
            status: false,
            code: 2004,
            error: err.message
        });
    }
});

module.exports = router;
