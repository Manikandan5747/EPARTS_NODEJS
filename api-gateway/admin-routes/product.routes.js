require('module-alias/register');

const express = require('express');
const router = express.Router();
const productRequester = require('@libs/requesters/admin-requesters/product-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
const uploadDir = path.join('/app/assets', 'products');
const multipartMiddleware = multipart({ uploadDir });
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs     = require('fs');
const fse        = require('fs-extra');
const tempUploadDir = path.join('/tmp', 'bulk-uploads');
fse.ensureDirSync(tempUploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, tempUploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB per file
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (file.fieldname === 'excel' && ['.xlsx', '.xls'].includes(ext)) return cb(null, true);
        if (file.fieldname === 'images' && ext === '.zip')                  return cb(null, true);
        cb(new Error(`Invalid file type for field "${file.fieldname}"`));
    }
}).fields([
    { name: 'excel',  maxCount: 1 },
    { name: 'images', maxCount: 1 }
]);


// ─────────────────────────────────────────────────────────────
// BULK UPLOAD
// ─────────────────────────────────────────────────────────────
router.post('/bulk-upload', (req, res) => {
    upload(req, res, async (err) => {
        try {
            if (err) {
                await saveErrorLog({
                    api_name:   'bulk-upload-products',
                    method:     'POST',
                    payload:    { body: req.body },
                    message:    err.message,
                    stack:      err.stack || '',
                    error_code: 2001
                });
                return res.status(400).json({
                    header_type:        'ERROR',
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            'Validation failed',
                    error:              err.message
                });
            }

            if (!req.files?.excel?.[0] || !req.files?.images?.[0]) {
                const errorMsg = 'Both excel (.xlsx/.xls) and images (.zip) files are required.';
                await saveErrorLog({
                    api_name:   'bulk-upload-products',
                    method:     'POST',
                    payload:    { body: req.body },
                    message:    errorMsg,
                    stack:      '',
                    error_code: 2001
                });
                return res.status(400).json({
                    header_type:        'ERROR',
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            'Validation failed',
                    error:              errorMsg
                });
            }

            // Enforce ZIP size ≤ 100 MB
            if (req.files.images[0].size > 100 * 1024 * 1024) {
                const errorMsg = 'ZIP file exceeds maximum allowed size of 100MB.';
                await saveErrorLog({
                    api_name:   'bulk-upload-products',
                    method:     'POST',
                    payload:    { body: req.body },
                    message:    errorMsg,
                    stack:      '',
                    error_code: 2001
                });
                return res.status(400).json({
                    header_type:        'ERROR',
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            'Validation failed',
                    error:              errorMsg
                });
            }

            if (!req.body.sellerUuid) {
    const errorMsg = 'sellerUuid is required.';
    await saveErrorLog({
        api_name:   'bulk-upload-products',
        method:     'POST',
        payload:    { body: req.body },
        message:    errorMsg,
        stack:      '',
        error_code: 2001
    });
    return res.status(400).json({
        header_type:        'ERROR',
        message_visibility: true,
        status:             false,
        code:               2001,
        message:            'Validation failed',
        error:              errorMsg
    });
}
            const jobId = uuidv4();

            const result = await productRequester.send({
                type: 'bulk-upload-products',
                body: {
                    jobId,
                    excelPath:  req.files.excel[0].path,
                    zipPath:    req.files.images[0].path,
                    uploadedBy: req.body.uploadedBy ?? null,
                    sellerUuid: req.body.sellerUuid ?? null                }
            });

            if (!result.status) {
                await saveErrorLog({
                    api_name:   'bulk-upload-products',
                    method:     'POST',
                    payload:    { body: req.body },
                    message:    result.error,
                    stack:      result.stack || '',
                    error_code: result.code || 2004
                });
                return res.status(500).json(result);
            }

            return res.status(202).json(result);

        } catch (e) {
            console.error('[POST /products/bulk-upload] error:', e);
            await saveErrorLog({
                api_name:   'bulk-upload-products',
                method:     'POST',
                payload:    { body: req.body },
                message:    e.message,
                stack:      e.stack || '',
                error_code: 2004
            });
            return res.status(500).json({
                header_type:        'ERROR',
                message_visibility: true,
                status:             false,
                code:               2004,
                message:            e.message,
                error:              e.message
            });
        }
    });
});


// ─────────────────────────────────────────────────────────────
// BULK UPLOAD STATUS
// ─────────────────────────────────────────────────────────────
router.get('/bulk-upload/status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;

        const result = await productRequester.send({
            type: 'bulk-upload-status',
            body: { jobId }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name:   'bulk-upload-status',
                method:     'GET',
                payload:    { jobId },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        return res.status(200).json(result);

    } catch (err) {
        logger.error('[GET /products/bulk-upload/status] error:', err.message);
        await saveErrorLog({
            api_name:   'bulk-upload-status',
            method:     'GET',
            payload:    { jobId: req.params.jobId },
            message:    err.message,
            stack:      err.stack,
            error_code: 2004
        });
        return res.status(500).json({
            header_type:        'ERROR',
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message
        });
    }
});





// --------------------------------------
// CREATE PRODUCT
// --------------------------------------

// router.post('/create', multipartMiddleware, async (req, res) => {
//     try {
//         // FILES - Handle multiple images upload
//         let imagePaths = [];

//         if (req.files && req.files.images) {
//             const images = req.files.images;
//             // images is already an array of file objects
//             imagePaths = Array.isArray(images)
//                 ? images.map(file => file.path)
//                 : [images.path]; // fallback if single file
//         }

//         // Fallback: if images passed as JSON array string (non-multipart)
//         if (imagePaths.length === 0 && req.body.images) {
//             try {
//                 imagePaths = typeof req.body.images === 'string'
//                     ? JSON.parse(req.body.images)
//                     : req.body.images;
//             } catch {
//                 imagePaths = Array.isArray(req.body.images)
//                     ? req.body.images
//                     : [req.body.images];
//             }
//         }

//         const result = await productRequester.send({
//             type: 'create-product',
//             body: {
//                 ...req.body,
//                 images: imagePaths
//             }
//         });

//         if (!result.status) {
//             await saveErrorLog({
//                 api_name: 'create-product',
//                 method: 'POST',
//                 payload: req.body,
//                 message: result.error,
//                 stack: result.stack || '',
//                 error_code: result.code || 2004
//             });
//             return res.status(500).json(result);
//         }

//         res.status(201).send(result);

//     } catch (err) {
//         logger.error("Error in products/create:", err.message);
//         await saveErrorLog({
//             api_name: 'create-product',
//             method: 'POST',
//             payload: req.body,
//             message: err.message,
//             stack: err.stack,
//             error_code: 2004
//         });
//         res.status(500).json({
//             header_type: "ERROR",
//             message_visibility: true,
//             status: false,
//             code: 2004,
//             message: err.message,
//             error: err.message
//         });
//     }
// });

router.post('/create', multipartMiddleware, async (req, res) => {
    try {
        // ── Images: files → paths ──
        let images = [];
        if (req.files?.images) {
            images = Array.isArray(req.files.images)
                ? req.files.images.map(f => f.path)
                : [req.files.images.path];
        }

        // ── Warehouses: JSON string → parse ──
        let warehouses = [];
        if (req.body.warehouses) {
            try {
                warehouses = typeof req.body.warehouses === "string"
                    ? JSON.parse(req.body.warehouses)
                    : req.body.warehouses;
            } catch {
                return res.status(400).json({
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              "warehouses must be a valid JSON array",
                });
            }
        }

        const result = await productRequester.send({
            type: "create-product",
            body: {
                ...req.body,
                images,
                warehouses,
            },
        });

        if (!result.status) {
            await saveErrorLog({
                api_name:   "create-product",
                method:     "POST",
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || "",
                error_code: result.code || 2004,
            });
            return res.status(400).json(result);
        }

        res.status(201).json(result);

    } catch (err) {
        logger.error("Error in product/create:", err.message);
        await saveErrorLog({
            api_name:   "create-product",
            method:     "POST",
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message,
        });
    }
});

// --------------------------------------
// CREATE SELLER INVENTORY
// --------------------------------------


router.post('/inventory/create', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'create-seller-inventory',
            body: {
                ...req.body,
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name:   'create-seller-inventory',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(201).send(result);

    } catch (err) {
        logger.error("Error in products/inventory/create:", err.message);
        await saveErrorLog({
            api_name:   'create-seller-inventory',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004
        });
        res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message
        });
    }
});

// --------------------------------------
// UPDATE PRODUCT
// --------------------------------------

router.post('/update/:product_uuid', multipartMiddleware, async (req, res) => {
    try {
        const { product_uuid } = req.params;

        // FILES - Handle multiple images upload
        let imagePaths = [];
        if (req.files && req.files.images) {
            const images = req.files.images;
            // images is already an array of file objects
            imagePaths = Array.isArray(images)
                ? images.map(file => file.path)
                : [images.path]; // fallback if single file
        }

        // Fallback: if images passed as JSON array string (non-multipart)
        if (imagePaths.length === 0 && req.body.images) {
            try {
                imagePaths = typeof req.body.images === 'string'
                    ? JSON.parse(req.body.images)
                    : req.body.images;
            } catch {
                imagePaths = Array.isArray(req.body.images)
                    ? req.body.images
                    : [req.body.images];
            }
        }

        const result = await productRequester.send({
            type: 'update-product',
            product_uuid,
            body: {
                ...req.body,
                images: imagePaths.length > 0 ? imagePaths : undefined  // ✅ undefined = responder uses existingImages fallback
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-product',
                method: 'POST',
                payload: { product_uuid, ...req.body },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(200).send(result);

    } catch (err) {
        logger.error("Error in products/update:", err.message);
        await saveErrorLog({
            api_name: 'update-product',
            method: 'POST',
            payload: { ...req.params, ...req.body },
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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
// UPDATE SELLER INVENTORY
// --------------------------------------

router.post('/update-seller-inventory/:inventory_uuid', async (req, res) => {
    try {
        const { inventory_uuid } = req.params;
        const result = await productRequester.send({
            type: 'update-seller-inventory',
            inventory_uuid,
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-seller-inventory',
                method: 'POST',
                payload: { inventory_uuid, ...req.body },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in update-seller-inventory:", err.message);
        await saveErrorLog({
            api_name: 'update-seller-inventory',
            method: 'POST',
            payload: { ...req.params, ...req.body },
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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
// CREATE STOCK ADJUSTMENT
// --------------------------------------


router.post('/create-stock-adjustment', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'create-stock-adjustment',
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-stock-adjustment',
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
        logger.error("Error in create-stock-adjustment:", err.message);
        await saveErrorLog({
            api_name: 'create-stock-adjustment',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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


// --------------------------------------------------
// GET BY ID -PRODUCT WITH EDIT LOCKING
// --------------------------------------------------


router.get('/findbyid/:product_uuid', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'getById-product',
            product_uuid: req.params.product_uuid,
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-product',
                method: 'GET',
                payload: req.params,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in getbyid-product:", err.message);
        await saveErrorLog({
            api_name: 'getById-product',
            method: 'GET',
            payload: req.params,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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


// --------------------------------------------------
// GET BY ID — SELLER INVENTORY WITH EDIT LOCKING
// --------------------------------------------------

router.get('/findbyid-seller-inventory/:inventory_uuid', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'getById-seller-inventory',
            inventory_uuid: req.params.inventory_uuid,
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-seller-inventory',
                method: 'GET',
                payload: req.params,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in getbyid-seller-inventory:", err.message);
        await saveErrorLog({
            api_name: 'getById-seller-inventory',
            method: 'GET',
            payload: req.params,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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

// --------------------------------------------------
// DELETE PRODUCT (SOFT DELETE)
// --------------------------------------------------

router.post('/delete/:product_uuid', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'delete-product',
            product_uuid: req.params.product_uuid,
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-product',
                method: 'DELETE',
                payload: { product_uuid: req.params.product_uuid, ...req.body },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(200).send(result);

    } catch (err) {
        logger.error("Error in products/delete:", err.message);
        await saveErrorLog({
            api_name: 'delete-product',
            method: 'DELETE',
            payload: { product_uuid: req.params.product_uuid, ...req.body },
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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


// --------------------------------------------------
// UPDATE PRODUCT STATUS (ACTIVE / INACTIVE)
// --------------------------------------------------

router.post('/status/:product_uuid', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'status-product',
            product_uuid: req.params.product_uuid,
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-product',
                method: 'POST',
                payload: { product_uuid: req.params.product_uuid, ...req.body },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(200).send(result);

    } catch (err) {
        logger.error("Error in products/status:", err.message);
        await saveErrorLog({
            api_name: 'status-product',
            method: 'POST',
            payload: { product_uuid: req.params.product_uuid, ...req.body },
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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



// --------------------------------------------------
// UNLOCK PRODUCT RECORD
// --------------------------------------------------

router.post('/unlock/:uuid', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'unlock-product',
            uuid: req.params.uuid,
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'unlock-product',
                method: 'POST',
                payload: { uuid: req.params.uuid, ...req.body },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(200).send(result);

    } catch (err) {
        logger.error("Error in products/unlock:", err.message);
        await saveErrorLog({
            api_name: 'unlock-product',
            method: 'POST',
            payload: { uuid: req.params.uuid, ...req.body },
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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

// --------------------------------------------------
// UNLOCK SELLER INVENTORY RECORD
// --------------------------------------------------


router.post('/unlock-seller-inventory/:inventory_uuid', async (req, res) => {
    try {
        const result = await productRequester.send({
            type:           'unlock-seller-inventory',
            inventory_uuid: req.params.inventory_uuid,
            body:           req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'unlock-seller-inventory',
                method:     'POST',
                payload:    { inventory_uuid: req.params.inventory_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in unlock-seller-inventory:", err.message);
        await saveErrorLog({
            api_name:   'unlock-seller-inventory',
            method:     'POST',
            payload:    { ...req.params, ...req.body },
            message:    err.message,
            stack:      err.stack,
            error_code: 2004
        });
        res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message
        });
    }
});

// --------------------------------------
// PAGINATION LIST
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'advancefilter-products',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'advancefilter-products',
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
        await saveErrorLog({
            api_name: 'advancefilter-products',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

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


// --------------------------------------------------
// VERIFY PRODUCT RECORD
// --------------------------------------------------


router.post('/verify/:id', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'verify-product',
            product_uuid: req.params.id,
            body: req.body
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'verify-product',
                method: 'POST',
                payload: { params: req.params, body: req.body },
                message: result.error,
                stack: result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.send(result);
    } catch (err) {
        logger.error("Error in verify-product:", err.message);
        await saveErrorLog({
            api_name: 'verify-product',
            method: 'POST',
            payload: { params: req.params, body: req.body },
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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

// --------------------------------------------------
// BULK VERIFICATION OF PRODUCTS
// --------------------------------------------------


router.post('/bulk-verify', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'bulk-verify-products',
            body: req.body
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'bulk-verify-products',
                method: 'POST',
                payload: { body: req.body },
                message: result.error,
                stack: result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.send(result);
    } catch (err) {
        logger.error("Error in bulk-verify-products:", err.message);
        await saveErrorLog({
            api_name: 'bulk-verify-products',
            method: 'POST',
            payload: { body: req.body },
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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

// --------------------------------------------------
// BARCODE VERIFICATION 
// --------------------------------------------------

router.post('/verify-barcode', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'verify-barcode',
            barcode_number: req.body.barcode_number,
            body: req.body
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'verify-barcode',
                method: 'POST',
                payload: { body: req.body },
                message: result.error,
                stack: result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.send(result);
    } catch (err) {
        logger.error("Error in verify-barcode:", err.message);
        await saveErrorLog({
            api_name: 'verify-barcode',
            method: 'POST',
            payload: { body: req.body },
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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

// --------------------------------------------------
// GET PRODUCT PRICE HISTORY
// --------------------------------------------------


router.get('/price-history/:product_uuid', async (req, res) => {
    try {
        const result = await productRequester.send({
            type:         'get-product-price-history',
            product_uuid: req.params.product_uuid,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-product-price-history',
                method:     'GET',
                payload:    req.params,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in product/price-history:", err.message);
        await saveErrorLog({
            api_name:   'get-product-price-history',
            method:     'GET',
            payload:    req.params,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message,
        });
    }
});

// --------------------------------------------------
// GET PRODUCT STOCK HISTORY
// --------------------------------------------------

router.get('/stock-history/:product_uuid', async (req, res) => {
    try {
        const result = await productRequester.send({
            type:         'get-product-stock-history',
            product_uuid: req.params.product_uuid,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-product-stock-history',
                method:     'GET',
                payload:    req.params,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in product/stock-history:", err.message);
        await saveErrorLog({
            api_name:   'get-product-stock-history',
            method:     'GET',
            payload:    req.params,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message,
        });
    }
});

// ============================================================
// GET PRODUCT AUDIT LOGS
// ============================================================

router.get('/audit-log/:product_uuid', async (req, res) => {
    try {
        const result = await productRequester.send({
            type:         'get-product-audit-log',
            product_uuid: req.params.product_uuid,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-product-audit-log',
                method:     'GET',
                payload:    req.params,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in product/audit-log:", err.message);
        await saveErrorLog({
            api_name:   'get-product-audit-log',
            method:     'GET',
            payload:    req.params,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message,
        });
    }
});

// ============================================================
// LOW STOCK PRODUCTS
// ============================================================

// router.get('/low-stock', async (req, res) => {
//     try {
//         const result = await productRequester.send({
//             type:  'get-low-stock-products',
//             query: req.query,
//         });
//         if (!result.status) {
//             await saveErrorLog({
//                 api_name:   'get-low-stock-products',
//                 method:     'GET',
//                 payload:    req.query,
//                 message:    result.error,
//                 stack:      result.stack || '',
//                 error_code: result.code || 2004,
//             });
//             return res.status(500).json(result);
//         }
//         res.json(result);
//     } catch (err) {
//         logger.error("Error in product/low-stock:", err.message);
//         await saveErrorLog({
//             api_name:   'get-low-stock-products',
//             method:     'GET',
//             payload:    req.query,
//             message:    err.message,
//             stack:      err.stack,
//             error_code: 2004,
//         });
//         res.status(500).json({
//             header_type:        "ERROR",
//             message_visibility: true,
//             status:             false,
//             code:               2004,
//             message:            err.message,
//             error:              err.message,
//         });
//     }
// });

router.post('/low-stock', async (req, res) => {
    try {
        const result = await productRequester.send({
            type:            'get-low-stock-products',
            query:           req.query,
            body:            req.body,
            dataAccessScope: req.dataAccessScope || null,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-low-stock-products',
                method:     'POST',
                payload:    { ...req.query, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in product/low-stock:", err.message);
        await saveErrorLog({
            api_name:   'get-low-stock-products',
            method:     'POST',
            payload:    { ...req.query, ...req.body },
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message,
        });
    }
});

// ============================================================
// OUT OF STOCK PRODUCTS
// ============================================================


router.post('/out-of-stock', async (req, res) => {
    try {
        const result = await productRequester.send({
            type:  'get-out-of-stock-products',
            query: req.query,
            body:  req.body,
            dataAccessScope: req.dataAccessScope || null,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-out-of-stock-products',
                method:     'POST',
                payload:    { ...req.query, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in product/out-of-stock:", err.message);
        await saveErrorLog({
            api_name:   'get-out-of-stock-products',
            method:     'POST',
            payload:    { ...req.query, ...req.body },
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message,
        });
    }
});

// ============================================================
// UPLOAD PRODUCT IMAGES
// ============================================================

router.post('/upload-images/:product_uuid', multipartMiddleware, async (req, res) => {
    try {
        // ── PRIMARY IMAGE ──
        let primary_image = null;
        if (req.files?.primary_image) {
            primary_image = Array.isArray(req.files.primary_image)
                ? req.files.primary_image[0].path
                : req.files.primary_image.path;
        }

        // ── GALLERY IMAGES ──
        let gallery_images = [];
        if (req.files?.gallery_images) {
            gallery_images = Array.isArray(req.files.gallery_images)
                ? req.files.gallery_images.map(f => f.path)
                : [req.files.gallery_images.path];
        }

        // ── DOCUMENT FILES ──
        let document_files = [];
        if (req.files?.document_files) {
            document_files = Array.isArray(req.files.document_files)
                ? req.files.document_files.map(f => f.path)
                : [req.files.document_files.path];
        }

        const result = await productRequester.send({
            type:         'upload-product-images',
            product_uuid: req.params.product_uuid,
            body: {
                ...req.body,
                primary_image,
                gallery_images,
                document_files,
            },
        });

        if (!result.status) {
            await saveErrorLog({
                api_name:   'upload-product-images',
                method:     'POST',
                payload:    { product_uuid: req.params.product_uuid },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(201).json(result);

    } catch (err) {
        logger.error("Error in product/upload-images:", err.message);
        await saveErrorLog({
            api_name:   'upload-product-images',
            method:     'POST',
            payload:    req.params,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message,
        });
    }
});

// ============================================================
// DELETE PRODUCT IMAGE
// ============================================================


router.post('/delete-image/:product_image_uuid', async (req, res) => {
    try {
        const result = await productRequester.send({
            type:               'delete-product-image',
            product_image_uuid: req.params.product_image_uuid,
            body:               req.body,
        });

        if (!result.status) {
            await saveErrorLog({
                api_name:   'delete-product-image',
                method:     'POST',
                payload:    { product_image_uuid: req.params.product_image_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.json(result);

    } catch (err) {
        logger.error("Error in product/image delete:", err.message);
        await saveErrorLog({
            api_name:   'delete-product-image',
            method:     'POST',
            payload:    { ...req.params, ...req.body },
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message,
        });
    }
});

// ============================================================
//  PRODUCT LIST
// ============================================================

router.post('/product-list', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'product-list',
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name  : 'product-list',
                method    : 'POST',
                payload   : req.body,
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        await saveErrorLog({
            api_name  : 'product-list',
            method    : 'POST',
            payload   : req.body,
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : err.message,
            error             : err.message
        });
    }
});


// ============================================================
//  PRODUCT SEARCH
// ============================================================

router.post('/search', async (req, res) => {
    try {
        const result = await productRequester.send({
            type: 'product-search',
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name  : 'product-search',
                method    : 'POST',
                payload   : req.body,
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        await saveErrorLog({
            api_name  : 'product-search',
            method    : 'POST',
            payload   : req.body,
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : err.message,
            error             : err.message
        });
    }
});

// --------------------------------------------------
// UPDATE OEM EQUIVALENTS
// --------------------------------------------------

router.post('/update-oem/:oem_uuid', async (req, res) => {
    try {
        const { oem_uuid } = req.params;
        const result = await productRequester.send({
            type: 'update-oem-equivalent',
            oem_uuid,
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-oem-equivalent',
                method: 'POST',
                payload: { oem_uuid, ...req.body },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in update-oem-equivalent:", err.message);
        await saveErrorLog({
            api_name: 'update-oem-equivalent',
            method: 'POST',
            payload: { ...req.params, ...req.body },
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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

// --------------------------------------------------
// DELETE OEM EQUIVALENTS
// --------------------------------------------------

router.post('/delete-oem/:oem_uuid', async (req, res) => {
    try {
        const result = await productRequester.send({
            type:     'delete-oem-equivalent',
            oem_uuid: req.params.oem_uuid,
            body:     req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'delete-oem-equivalent',
                method:     'POST',
                payload:    { oem_uuid: req.params.oem_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in oem-equivalent delete:", err.message);
        await saveErrorLog({
            api_name:   'delete-oem-equivalent',
            method:     'POST',
            payload:    { ...req.params, ...req.body },
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message,
        });
    }
});

// --------------------------------------------------
// UPDATE PRODUCT PRICE
// --------------------------------------------------

router.post('/update-price/:product_uuid', async (req, res) => {
    try {
        const { product_uuid } = req.params;
        const result = await productRequester.send({
            type: 'update-product-price',
            product_uuid,
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-product-price',
                method: 'POST',
                payload: { product_uuid, ...req.body },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in update-product-price:", err.message);
        await saveErrorLog({
            api_name: 'update-product-price',
            method: 'POST',
            payload: { ...req.params, ...req.body },
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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
