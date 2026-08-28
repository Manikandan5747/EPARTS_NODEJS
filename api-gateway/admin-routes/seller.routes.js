require('module-alias/register');

const express = require('express');
const router = express.Router();
const sellerRequester = require('@libs/requesters/admin-requesters/seller-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
const uploadDir = path.join('/app/assets', 'admin-seller');
const multipartMiddleware = multipart({ uploadDir });

// --------------------------------------
//  ADMIN - SELLER MANAGEMENT - FILE SAVE 
// --------------------------------------

router.post('/admin-seller-filesave', multipartMiddleware, async (req, res) => {
    try {

        const result = await sellerRequester.send({
            type: 'admin-seller-filesave',
            body: req.body,
            files: req.files
        });

        if (!result.status) {

            await saveErrorLog({
                api_name: 'admin-seller-filesave',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });

            return res.status(500).json(result);
        }

        return res.status(200).json(result);

    } catch (err) {

        logger.error("Error in filesave:", err.message);

        await saveErrorLog({
            api_name: 'admin-seller-filesave',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

        return res.status(500).json({
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
//  ADMIN - SELLER MANAGEMENT - CREATE 
// --------------------------------------

router.post('/create-admin-seller/:account_type_name', async (req, res) => {
    try {


        const result = await sellerRequester.send({
            type: 'create-admin-seller',
            account_type_name: req.params.account_type_name,
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'create-admin-seller',
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
        logger.error("Error in seller/create:", err.message);
        await saveErrorLog({
            api_name: 'create-admin-seller',
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



// --------------------------------------
//  ADMIN - SELLER MANAGEMENT - UPDATE 
// --------------------------------------
router.post('/update-admin-seller/:account_type_name', async (req, res) => {
    try {
        const result = await sellerRequester.send({
            type: 'update-admin-seller',
            account_type_name: req.params.account_type_name,
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'update-admin-seller',
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
        logger.error("Error in seller/update:", err.message);

        await saveErrorLog({
            api_name: 'update-admin-seller',
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
// ADMIN - SELLER MANAGEMENT - LIST BY ID WITH EDIT LOCK
// --------------------------------------------------


router.post('/listbyidwithlock-admin-seller/:id', async (req, res) => {
    try {


        const result = await sellerRequester.send({
            type: 'listbyidwithlock-admin-seller',
            seller_uuid: req.params.id,
            body: { user_id: req.body.user_id, mode: req.body.mode }

        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'listbyidwithlock-admin-seller',
                method: 'POST',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in seller/listbyidwithlock:", err.message);

        // SAVE ERROR LOG for unexpected exception
        await saveErrorLog({
            api_name: 'listbyidwithlock-admin-seller',
            method: 'POST',
            payload: { seller_uuid: req.params.id },
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


// -----------------------------------------------
// ADMIN - SELLER MANAGEMENT - WAREHOUSE - DELETE 
// -----------------------------------------------
router.post('/delete-seller-warehouse/:id', async (req, res) => {
    try {
        const result = await sellerRequester.send({
            type: 'delete-seller-warehouse',
            warehouse_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'delete-seller-warehouse',
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
        logger.error("Error in seller-warehouse/delete:", err.message);

        await saveErrorLog({
            api_name: 'delete-seller-warehouse',
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


// --------------------------------------
// ADMIN - SELLER MANAGEMENT - DELETE 
// --------------------------------------
router.post('/delete-admin-seller/:id', async (req, res) => {
    try {
        const result = await sellerRequester.send({
            type: 'delete-admin-seller',
            seller_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'delete-admin-seller',
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
        logger.error("Error in seller/delete:", err.message);

        await saveErrorLog({
            api_name: 'delete-admin-seller',
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


// --------------------------------------
// ADVANCE FILTER + PAGINATION LIST
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await sellerRequester.send({
            type: 'advancefilter-seller',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'advancefilter-seller',
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
            api_name: 'advancefilter-seller',
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


// --------------------------------------
// PHONE NUMBER VERIFICATION
// --------------------------------------
router.post('/verify-seller/:id', async (req, res) => {
    try {
        const result = await sellerRequester.send({
            type: 'verify-number',
            seller_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'verify-number',
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
        logger.error("Error in seller/verification:", err.message);
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
// UNLOCK RECORD (SAVE / CANCEL)
// --------------------------------------

router.post('/admin-seller-unlock/:id', async (req, res) => {
    try {
        const result = await sellerRequester.send({
            type: 'unlock-admin-seller',
            uuid: req.params.id,
            body: { user_id: req.body.user_id }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'unlock-admin-seller',
                method: 'POST',
                payload: {
                    uuid: req.params.id,
                    user_id: req.body.user_id
                },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });

            return res.status(500).json(result);
        }

        return res.json(result);

    } catch (err) {
        logger.error(err.message);
        return res.status(500).json({
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
// FORGOT PASSWORD 
// --------------------------------------
router.post('/forgotpassword', async (req, res) => {
    try {
        const result = await sellerRequester.send({
            type: 'forgotpassword-seller',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'forgotpassword-seller',
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
        logger.error("Error in users/forgotpassword-seller:", err.message);

        await saveErrorLog({
            api_name: 'forgotpassword-seller',
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


// --------------------------------------
// CHANGE PASSWORD 
// --------------------------------------
router.post('/resetpassword', async (req, res) => {
    try {
        const result = await sellerRequester.send({
            type: 'changepassword-seller',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'changepassword-seller',
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
        logger.error("Error in users/changepassword-seller:", err.message);

        await saveErrorLog({
            api_name: 'changepassword-seller',
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

// -----------------------------
// GENERATE NEXT SELLER CODE
// -----------------------------

router.get('/generate-code', async (req, res) => {
    try {
        const result = await sellerRequester.send({
            type: 'generate-code-seller',
            body: req.body
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'generate-code-seller',
                method: 'GET',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.send(result);
    } catch (err) {
        logger.error("Error in seller-accounts/generate-code-seller:", err.message);
        await saveErrorLog({
            api_name: 'generate-code-seller',
            method: 'GET',
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

module.exports = router;
