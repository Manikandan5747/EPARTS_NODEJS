require('module-alias/register');

const express = require('express');
const router = express.Router();
const buyerRequester = require('@libs/requesters/admin-requesters/buyer-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
const uploadDir = path.join('/app/assets', 'admin-buyer');
const multipartMiddleware = multipart({ uploadDir });

// --------------------------------------
//  ADMIN - BUYER MANAGEMENT - FILE SAVE 
// --------------------------------------

router.post('/admin-buyer-filesave', multipartMiddleware, async (req, res) => {
    try {

        const result = await buyerRequester.send({
            type: 'admin-buyer-filesave',
            body: req.body,
            files: req.files
        });

        if (!result.status) {

            await saveErrorLog({
                api_name: 'admin-buyer-filesave',
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
            api_name: 'admin-buyer-filesave',
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
//  ADMIN - BUYER MANAGEMENT - CREATE 
// --------------------------------------

router.post('/create-admin-buyer/:account_type_name', async (req, res) => {
    try {


        const result = await buyerRequester.send({
            type: 'create-admin-buyer',
            account_type_name: req.params.account_type_name,
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'create-admin-buyer',
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
        logger.error("Error in buyer/create:", err.message);
        await saveErrorLog({
            api_name: 'create-admin-buyer',
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
//  ADMIN - BUYER MANAGEMENT - UPDATE 
// --------------------------------------
router.post('/update-admin-buyer/:account_type_name', async (req, res) => {
    try {
        const result = await buyerRequester.send({
            type: 'update-admin-buyer',
            account_type_name: req.params.account_type_name,
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'update-admin-buyer',
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
        logger.error("Error in buyer/update:", err.message);

        await saveErrorLog({
            api_name: 'update-admin-buyer',
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
// ADMIN - BUYER MANAGEMENT - LIST BY ID WITH EDIT LOCK
// --------------------------------------------------

router.post('/listbyidwithlock-admin-buyer/:id', async (req, res) => {
    try {


        const result = await buyerRequester.send({
            type: 'listbyidwithlock-admin-buyer',
            buyer_uuid: req.params.id,
            body: { user_id: req.body.user_id, mode: req.body.mode }

        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'listbyidwithlock-admin-buyer',
                method: 'POST',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in buyer/listbyidwithlock:", err.message);

        // SAVE ERROR LOG for unexpected exception
        await saveErrorLog({
            api_name: 'listbyidwithlock-admin-buyer',
            method: 'POST',
            payload: { buyer_uuid: req.params.id },
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
// ADMIN - BUYER MANAGEMENT - DELETE 
// --------------------------------------
router.post('/delete-admin-buyer/:id', async (req, res) => {
    try {
        const result = await buyerRequester.send({
            type: 'delete-admin-buyer',
            buyer_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'delete-admin-buyer',
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
        logger.error("Error in buyer/delete:", err.message);

        await saveErrorLog({
            api_name: 'delete-admin-buyer',
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
        const result = await buyerRequester.send({
            type: 'advancefilter-buyer',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'advancefilter-buyer',
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
            api_name: 'advancefilter-buyer',
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
router.post('/verify-buyer/:id', async (req, res) => {
    try {
        const result = await buyerRequester.send({
            type: 'verify-number',
            buyer_uuid: req.params.id,
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
        logger.error("Error in buyer/verification:", err.message);
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

router.post('/admin-buyer-unlock/:id', async (req, res) => {
    try {
        const result = await buyerRequester.send({
            type: 'unlock-admin-buyer',
            uuid: req.params.id,
            body: { user_id: req.body.user_id }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'unlock-admin-buyer',
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
        const result = await buyerRequester.send({
            type: 'forgotpassword-buyer',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'forgotpassword-buyer',
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
        logger.error("Error in users/forgotpassword-buyer:", err.message);

        await saveErrorLog({
            api_name: 'forgotpassword-buyer',
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
        const result = await buyerRequester.send({
            type: 'changepassword-buyer',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'changepassword-buyer',
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
        logger.error("Error in users/changepassword-buyer:", err.message);

        await saveErrorLog({
            api_name: 'changepassword-buyer',
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
// GENERATE NEXT BUYER CODE
// -----------------------------


router.get('/generate-code', async (req, res) => {
    try {
        const result = await buyerRequester.send({
            type: 'generate-code-buyer',
            body: req.body
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'generate-code-buyer',
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
        logger.error("Error in buyer-accounts/generate-code-buyer:", err.message);
        await saveErrorLog({
            api_name: 'generate-code-buyer',
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
