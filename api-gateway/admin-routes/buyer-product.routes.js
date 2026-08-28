require('module-alias/register');

const express = require('express');
const router = express.Router();
const buyerProductRequester = require('@libs/requesters/admin-requesters/buyer-product-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
const uploadDir = path.join('/app/assets', 'buyer-product');
const multipartMiddleware = multipart({ uploadDir });

// --------------------------------------
//   BUYER - VIEW PRODUCT DETAILS
// --------------------------------------

router.get('/detail/:product_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'getById-product-detail',
            product_uuid: req.params.product_uuid,
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-product-detail',
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
        logger.error("Error in getbyid-product-detail:", err.message);
        await saveErrorLog({
            api_name: 'getById-product-detail',
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
// PRODUCT SEARCH — BUYER 
// --------------------------------------------------

router.post('/search', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'search-product-buyer',
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name  : 'search-product-buyer',
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
            api_name  : 'search-product-buyer',
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
// PRODUCT SEARCH WITH ETA
// --------------------------------------------------

router.post('/search-eta', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'search-product-eta',
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name  : 'search-product-eta',
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
            api_name  : 'search-product-eta',
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
// ADD PRODUCT TO CART
// --------------------------------------------------


router.post('/add-cart', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'add-to-cart',
            body: {
                ...req.body,
            }
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'add-to-cart',
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
        logger.error("Error in buyer/cart/add:", err.message);
        await saveErrorLog({
            api_name:   'add-to-cart',
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

// --------------------------------------------------
// GET CART
// --------------------------------------------------

router.post('/get-cart', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-cart',
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name  : 'get-cart',
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
            api_name  : 'get-cart',
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
// DELETE ITEM FROM CART
// --------------------------------------------------
router.post('/delete-cart/:cart_item_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type:           'remove-cart-item',
            cart_item_uuid: req.params.cart_item_uuid,
            body:           req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'remove-cart-item',
                method:     'POST',
                payload:    { cart_item_uuid: req.params.cart_item_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in remove-cart-item:", err.message);
        await saveErrorLog({
            api_name:   'remove-cart-item',
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
// BULK DELETE CART ITEMS BY BUYER
// --------------------------------------------------

router.post('/bulk-delete-cart', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'bulk-remove-cart-items',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'bulk-remove-cart-items',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in bulk-remove-cart-items:", err.message);
        await saveErrorLog({
            api_name:   'bulk-remove-cart-items',
            method:     'POST',
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

// --------------------------------------------------
// UPDATE CART QUANTITY
// --------------------------------------------------

router.post('/update-cart-quantity/:cart_item_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type:           'update-cart-item-quantity',
            cart_item_uuid: req.params.cart_item_uuid,
            body:           req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'update-cart-item-quantity',
                method:     'POST',
                payload:    { cart_item_uuid: req.params.cart_item_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in update-cart-item-quantity:", err.message);
        await saveErrorLog({
            api_name:   'update-cart-item-quantity',
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
// CREATE BUYER QUOTE (Single + Bulk)
// --------------------------------------------------
router.post('/create-quote', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'create-buyer-quote',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'create-buyer-quote',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in create-buyer-quote:", err.message);
        await saveErrorLog({
            api_name:   'create-buyer-quote',
            method:     'POST',
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


// --------------------------------------------------
// ADD ITEMS TO EXISTING DRAFT QUOTE
// --------------------------------------------------
router.post('/add-quote-item/:buyer_quote_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type:     'add-quote-items',
            buyer_quote_uuid : req.params.buyer_quote_uuid ,
            body:     req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'add-quote-items',
                method:     'POST',
                payload:    { buyer_quote_uuid : req.params.buyer_quote_uuid , ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in add-quote-items:", err.message);
        await saveErrorLog({
            api_name:   'add-quote-items',
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
// UPDATE BUYER QUOTE
// --------------------------------------------------
router.post('/update-buyer-quote/:buyer_quote_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type:               'update-buyer-quote',
            buyer_quote_uuid:   req.params.buyer_quote_uuid,
            body:               req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'update-buyer-quote',
                method:     'POST',
                payload:    { buyer_quote_uuid: req.params.buyer_quote_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in update-buyer-quote:", err.message);
        await saveErrorLog({
            api_name:   'update-buyer-quote',
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
// GET BUYER QUOTES
// --------------------------------------------------
router.post('/get-buyer-quote', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-buyer-quotes',
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name  : 'get-buyer-quotes',
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
            api_name  : 'get-buyer-quotes',
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
// GET BUYER QUOTE BY ID (WITH EDIT LOCKING)
// --------------------------------------------------
router.post('/get-buyer-quote/:buyer_quote_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type:             'getById-buyer-quote',
            buyer_quote_uuid: req.params.buyer_quote_uuid,
            body:             req.body,   // { mode: 'edit' | 'view', user_id }
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'getById-buyer-quote',
                method:     'POST',
                payload:    { buyer_quote_uuid: req.params.buyer_quote_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in getById-buyer-quote:", err.message);
        await saveErrorLog({
            api_name:   'getById-buyer-quote',
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


// ----------------------------------------------------------------
// DELETE BUYER QUOTE
// ----------------------------------------------------------------
router.post('/delete-buyer-quote/:buyer_quote_uuid', async (req, res) => {
    try {
        const { buyer_quote_uuid } = req.params;
        const result = await buyerProductRequester.send({
            type:             'delete-buyer-quote',
            buyer_quote_uuid,
            body:             req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'delete-buyer-quote',
                method:     'POST',
                payload:    { buyer_quote_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
         return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in delete-buyer-quote:", err.message);
        await saveErrorLog({
            api_name:   'delete-buyer-quote',
            method:     'POST',
            payload:    { buyer_quote_uuid: req.params.buyer_quote_uuid, ...req.body },
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message
        });
    }
});

// ----------------------------------------------------------------
// PRINT BUYER QUOTE
// ----------------------------------------------------------------
router.post('/print-buyer-quote/:buyer_quote_uuid', async (req, res) => {
    try {
        const { buyer_quote_uuid } = req.params;
        const result = await buyerProductRequester.send({
            type:             'print-buyer-quote',
            buyer_quote_uuid,
            body:             req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'print-buyer-quote',
                method:     'POST',
                payload:    { buyer_quote_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
          return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in print-buyer-quote:", err.message);
        await saveErrorLog({
            api_name:   'print-buyer-quote',
            method:     'POST',
            payload:    { buyer_quote_uuid: req.params.buyer_quote_uuid, ...req.body },
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message
        });
    }
});

// --------------------------------------------------
// GET BUYER QUOTE HISTORY
// --------------------------------------------------
router.get('/get-buyer-quote-history/:buyer_quote_uuid', async (req, res) => {
    try {
        const { buyer_quote_uuid } = req.params;

        const result = await buyerProductRequester.send({
            type: 'get-buyer-quote-history',
            buyer_quote_uuid,
        });

        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-buyer-quote-history',
                method:     'GET',
                payload:    { buyer_quote_uuid },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }

        res.status(200).json(result);

    } catch (err) {
        logger.error("Error in get-buyer-quote-history:", err.message);
        await saveErrorLog({
            api_name:   'get-buyer-quote-history',
            method:     'GET',
            payload:    { buyer_quote_uuid: req.params.buyer_quote_uuid },
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

// ----------------------------------------------------------------
// UPSERT BUYER QUOTE PRINT HISTORY
// ----------------------------------------------------------------
router.post('/upsert-buyer-quote-print-history/:buyer_quote_uuid', async (req, res) => {
    try {
        const { buyer_quote_uuid } = req.params;
        const result = await buyerProductRequester.send({
            type:             'upsert-buyer-quote-print-history',
            buyer_quote_uuid,
            body:             req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'upsert-buyer-quote-print-history',
                method:     'POST',
                payload:    { buyer_quote_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
           return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in upsert-buyer-quote-print-history:", err.message);
        await saveErrorLog({
            api_name:   'upsert-buyer-quote-print-history',
            method:     'POST',
            payload:    { buyer_quote_uuid: req.params.buyer_quote_uuid, ...req.body },
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message
        });
    }
});

// ----------------------------------------------------------------
// GET BUYER QUOTE PRINT HISTORY
// ----------------------------------------------------------------
router.post('/get-buyer-quote-print-history', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-buyer-quote-print-history',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-buyer-quote-print-history',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
          return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-buyer-quote-print-history:", err.message);
        await saveErrorLog({
            api_name:   'get-buyer-quote-print-history',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message
        });
    }
});

// ----------------------------------------------------------------
// GET BUYER QUOTE PRINT COUNT
// ----------------------------------------------------------------
router.post('/get-buyer-quote-print-count/:buyer_quote_uuid', async (req, res) => {
    try {
        const { buyer_quote_uuid } = req.params;
        const result = await buyerProductRequester.send({
            type:             'get-buyer-quote-print-count',
            buyer_quote_uuid,
            body:             req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-buyer-quote-print-count',
                method:     'POST',
                payload:    { buyer_quote_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
            return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-buyer-quote-print-count:", err.message);
        await saveErrorLog({
            api_name:   'get-buyer-quote-print-count',
            method:     'POST',
            payload:    { buyer_quote_uuid: req.params.buyer_quote_uuid, ...req.body },
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message
        });
    }
});

// --------------------------------------------------
// CREATE WALLET ACCOUNT
// --------------------------------------------------
router.post('/wallet/create', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'create-wallet-account',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'create-wallet-account',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
          return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in create-wallet-account:", err.message);
        await saveErrorLog({
            api_name:   'create-wallet-account',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    }
});


// --------------------------------------------------
// CHECK WALLET BALANCE
// --------------------------------------------------
router.post('/wallet/balance-check', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'check-wallet-balance',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'check-wallet-balance',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
            return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in check-wallet-balance:", err.message);
        await saveErrorLog({
            api_name:   'check-wallet-balance',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    }
});


// --------------------------------------------------
// CHECKOUT INITIATE
// --------------------------------------------------

router.post('/checkout/initiate', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'checkout-initiate',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'checkout-initiate',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in checkout-initiate:", err.message);
        await saveErrorLog({
            api_name:   'checkout-initiate',
            method:     'POST',
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

// --------------------------------------------------
// GET CHECKOUT DETAILS
// --------------------------------------------------

router.post('/checkout-details', async (req, res) => {
    try {
        const { checkout_uuid, buyer_uuid } = req.body;
        const result = await buyerProductRequester.send({
            type: 'get-checkout-details',
            body: { checkout_uuid, buyer_uuid },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-checkout-details',
                method:     'POST',
                payload:    { checkout_uuid, buyer_uuid },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-checkout-details:", err.message);
        await saveErrorLog({
            api_name:   'get-checkout-details',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
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
// CHECKOUT ADDRESS UPDATE
// --------------------------------------------------


router.post('/checkout-address-update/:checkout_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'checkout-update-address',
            body: {
                checkout_uuid: req.params.checkout_uuid,
                ...req.body,
            },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'checkout-update-address',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in checkout-update-address:", err.message);
        await saveErrorLog({
            api_name:   'checkout-update-address',
            method:     'POST',
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


// --------------------------------------------------
// CHECKOUT PAYMENT METHOD UPDATE
// --------------------------------------------------


router.post('/checkout-payment-method-update/:checkout_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'checkout-update-payment-method',
            body: {
                checkout_uuid: req.params.checkout_uuid,
                ...req.body,
            },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'checkout-update-payment-method',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in checkout-update-payment-method:", err.message);
        await saveErrorLog({
            api_name:   'checkout-update-payment-method',
            method:     'POST',
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

// --------------------------------------------------
// CHECKOUT CALCULATE
// --------------------------------------------------


router.post('/checkout-calculate/:checkout_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'checkout-calculate',
            body: {
                checkout_uuid: req.params.checkout_uuid,
                ...req.body,
            },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'checkout-calculate',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in checkout-calculate:", err.message);
        await saveErrorLog({
            api_name:   'checkout-calculate',
            method:     'POST',
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

// --------------------------------------------------
// CHECKOUT CONFIRM
// --------------------------------------------------


router.post('/checkout-confirm/:checkout_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'checkout-confirm',
            body: {
                checkout_uuid: req.params.checkout_uuid,
                ...req.body,
            },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'checkout-confirm',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in checkout-confirm:", err.message);
        await saveErrorLog({
            api_name:   'checkout-confirm',
            method:     'POST',
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

// --------------------------------------------------
// CHECKOUT STATUS
// --------------------------------------------------
router.post('/checkout-status/:checkout_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'checkout-status',
            body: {
                checkout_uuid: req.params.checkout_uuid,
                ...req.body,
            },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'checkout-status',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in checkout-status:", err.message);
        await saveErrorLog({
            api_name:   'checkout-status',
            method:     'POST',
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


// --------------------------------------------------
// CHECKOUT CANCEL
// --------------------------------------------------
router.post('/checkout-cancel/:checkout_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'checkout-cancel',
            body: {
                checkout_uuid: req.params.checkout_uuid,
                ...req.body,
            },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'checkout-cancel',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in checkout-cancel:", err.message);
        await saveErrorLog({
            api_name:   'checkout-cancel',
            method:     'POST',
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

// --------------------------------------------------
// CHECKOUT PAYMENT - TODO
// --------------------------------------------------


router.post('/checkout-payment/:checkout_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'checkout-payment',
            body: {
                checkout_uuid: req.params.checkout_uuid,
                ...req.body,
            },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'checkout-payment',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in checkout-payment:", err.message);
        await saveErrorLog({
            api_name:   'checkout-payment',
            method:     'POST',
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


// --------------------------------------------------
// PAYMENT INITIATION
// --------------------------------------------------

router.post('/payment-initiate', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'payments-initiate',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'payments-initiate',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
          return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in payments-initiate:", err.message);
        await saveErrorLog({
            api_name:   'payments-initiate',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    }
});

// --------------------------------------------------
// GET PAYMENT DETAILS
// --------------------------------------------------


router.post('/payment-get', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'payments-get',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'payments-get',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
          return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in payments-get:", err.message);
        await saveErrorLog({
            api_name:   'payments-get',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    }
});

// --------------------------------------------------
// PAYMENT RETRY
// --------------------------------------------------
router.post('/payment-retry', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'payments-retry',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'payments-retry',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
          return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in payments-retry:", err.message);
        await saveErrorLog({
            api_name:   'payments-retry',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    }
});

// --------------------------------------------------
//  PAYMENT CANCEL
// --------------------------------------------------

router.post('/payment-cancel', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'payment-cancel',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'payment-cancel',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
          return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in payment-cancel:", err.message);
        await saveErrorLog({
            api_name:   'payment-cancel',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    }
});

// --------------------------------------------------
// OFFLINE WALLET RECHARGE
// --------------------------------------------------


router.post('/wallet-offline-recharge', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'wallet-recharge',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'wallet-recharge',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
            return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in wallet-recharge:", err.message);
        await saveErrorLog({
            api_name:   'wallet-recharge',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    }
});



// --------------------------------------------------
// BUYER PAYMENT TRANSACTION HISTORY
// --------------------------------------------------
router.post('/payment-history', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-buyer-payment-history',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-buyer-payment-history',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
            return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-buyer-payment-history:", err.message);
        await saveErrorLog({
            api_name:   'get-buyer-payment-history',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    }
});

// --------------------------------------------------
//  PAYMENT RECEIPT
// --------------------------------------------------

router.post('/payment-receipt', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-payment-receipt',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-payment-receipt',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
            return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-payment-receipt:", err.message);
        await saveErrorLog({
            api_name:   'get-payment-receipt',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    }
});

// --------------------------------------------------
// GET WALLET TRANSACTION HISTORY
// --------------------------------------------------


router.post('/wallet-transaction-history', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-wallet-transaction-history',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-wallet-transaction-history',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
            return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-wallet-transaction-history:", err.message);
        await saveErrorLog({
            api_name:   'get-wallet-transaction-history',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    }
});


// --------------------------------------------------
// GET WALLET RECHARGE HISTORY
// --------------------------------------------------


router.post('/wallet-recharge-history', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-wallet-recharge-history',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-wallet-recharge-history',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code  || 2004,
            });
            return res.status(500).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-wallet-recharge-history:", err.message);
        await saveErrorLog({
            api_name:   'get-wallet-recharge-history',
            method:     'POST',
            payload:    req.body,
            message:    err.message,
            stack:      err.stack,
            error_code: 2004,
        });
        return res.status(500).json({
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    }
});

// --------------------------------------------------
// ORDER CREATION
// --------------------------------------------------

router.post('/order-create', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'order-create',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'order-create',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in order-create:", err.message);
        await saveErrorLog({
            api_name: 'order-create',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message,
        });
    }
});

// --------------------------------------------------
// ORDER LIST WITH PAGINATION
// --------------------------------------------------

router.post('/order-list', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-buyer-orders',
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name  : 'get-buyer-orders',
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
            api_name  : 'get-buyer-orders',
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
// GET ORDER BY UUID 
// --------------------------------------------------

router.post('/get-buyer-order/:order_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type:      'getById-buyer-order',
            order_uuid: req.params.order_uuid,
            body:      req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'getById-buyer-order',
                method:     'POST',
                payload:    { order_uuid: req.params.order_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in getById-buyer-order:", err.message);
        await saveErrorLog({
            api_name:   'getById-buyer-order',
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
// GET ACTIVE BUYER ORDERS  
// --------------------------------------------------


router.post('/order-active-list', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-active-buyer-orders',
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name  : 'get-active-buyer-orders',
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
            api_name  : 'get-active-buyer-orders',
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
// GET COMPLETED BUYER ORDERS  
// --------------------------------------------------

router.post('/order-delivered-list', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-delivered-buyer-orders',
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name  : 'get-delivered-buyer-orders',
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
            api_name  : 'get-delivered-buyer-orders',
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
// ORDER CANCELLATION 
// --------------------------------------------------

router.post('/order-cancel', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'order-cancel',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'order-cancel',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in order-cancel:", err.message);
        await saveErrorLog({
            api_name: 'order-cancel',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message,
        });
    }
});

// --------------------------------------------------
// CANCELLED ORDER LIST 
// --------------------------------------------------


router.post('/order-cancelled-list', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-cancelled-buyer-orders',
            body: req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name  : 'get-cancelled-buyer-orders',
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
            api_name  : 'get-cancelled-buyer-orders',
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
// GET COMPLETED ORDERS BY UUID
// --------------------------------------------------

router.post('/order-delivered-list/:order_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type:       'get-delivered-buyer-order',
            order_uuid: req.params.order_uuid,
            body:       req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-delivered-buyer-order',
                method:     'POST',
                payload:    { order_uuid: req.params.order_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-delivered-buyer-order:", err.message);
        await saveErrorLog({
            api_name:   'get-delivered-buyer-order',
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
// REORDER BUYER ORDER
// --------------------------------------------------

router.post('/reorder', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'reorder-buyer-order',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'reorder-buyer-order',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in reorder-buyer-order:", err.message);
        await saveErrorLog({
            api_name: 'reorder-buyer-order',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message,
        });
    }
});

// --------------------------------------------------
// LIST OF REORDER-ELIGIBLE-ITEMS
// --------------------------------------------------

router.post('/list-reorder-items', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'list-reorder-eligible-items',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-reorder-eligible-items',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in list-reorder-eligible-items:", err.message);
        await saveErrorLog({
            api_name: 'list-reorder-eligible-items',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message,
        });
    }
});

// --------------------------------------------------
// ORDER LIFE CYCLE HISTORY
// --------------------------------------------------

router.post('/order-lifecycle-history', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-order-lifecycle-history',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'get-order-lifecycle-history',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-order-lifecycle-history:", err.message);
        await saveErrorLog({
            api_name: 'get-order-lifecycle-history',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message,
        });
    }
});


// --------------------------------------------------
// ADD PRODUCT TO WISHLIST
// --------------------------------------------------
router.post('/add-wishlist-items', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'add-to-wishlist',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'add-to-wishlist',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in add-to-wishlist:", err.message);
        await saveErrorLog({
            api_name: 'add-to-wishlist',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message,
        });
    }
});

// --------------------------------------------------
// GET BUYER WISHLIST 
// --------------------------------------------------
router.post('/get-wishlist', async (req, res) => {
    try {
        const { buyer_uuid, sort_by, sort_order, Page, PageSize } = req.body;
        const result = await buyerProductRequester.send({
            type: 'get-buyer-wishlist',
            body: { buyer_uuid, sort_by, sort_order, Page, PageSize },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'get-buyer-wishlist',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-buyer-wishlist:", err.message);
        await saveErrorLog({
            api_name: 'get-buyer-wishlist',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message,
        });
    }
});

// --------------------------------------------------
// GET WISHLIST ITEM DETAIL
// --------------------------------------------------
router.post('/get-wishlist-item/:wishlist_item_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-wishlist-item',
            body: {
                wishlist_item_uuid: req.params.wishlist_item_uuid,
                buyer_uuid:         req.body.buyer_uuid,
            },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'get-wishlist-item',
                method:     'POST',
                payload:    { wishlist_item_uuid: req.params.wishlist_item_uuid, ...req.body },
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-wishlist-item:", err.message);
        await saveErrorLog({
            api_name:   'get-wishlist-item',
            method:     'POST',
            payload:    { wishlist_item_uuid: req.params.wishlist_item_uuid, ...req.body },
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
//MOVE WISHLIST ITEM TO CART
// --------------------------------------------------
router.post('/wishlist-move-to-cart/:wishlist_item_uuid', async (req, res) => {
    try {
        const { wishlist_item_uuid } = req.params;
        const result = await buyerProductRequester.send({
            type: 'move-wishlist-to-cart',
            body: { ...req.body, wishlist_item_uuid },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'move-wishlist-to-cart',
                method: 'POST',
                payload: { ...req.params, ...req.body },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in move-wishlist-to-cart:", err.message);
        await saveErrorLog({
            api_name: 'move-wishlist-to-cart',
            method: 'POST',
            payload: { ...req.params, ...req.body },
            message: err.message,
            stack: err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message,
        });
    }
});

// --------------------------------------------------
// DELETE WISHLIST ITEM
// --------------------------------------------------
router.post('/delete-wishlist/:wishlist_item_uuid', async (req, res) => {
    try {
        const { wishlist_item_uuid } = req.params;
        const { buyer_uuid, deleted_by } = req.body;
        const result = await buyerProductRequester.send({
            type: 'delete-wishlist-item',
            body: { wishlist_item_uuid, buyer_uuid, deleted_by },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-wishlist-item',
                method: 'POST',
                payload: { ...req.params, ...req.query },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in delete-wishlist-item:", err.message);
        await saveErrorLog({
            api_name: 'delete-wishlist-item',
            method: 'POST',
            payload: { ...req.params, ...req.query },
            message: err.message,
            stack: err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message,
        });
    }
});

// --------------------------------------------------
// GET WISHLIST COUNT 
// --------------------------------------------------
router.post('/wishlist-count', async (req, res) => {
    try {
        const { buyer_uuid } = req.body;
        const result = await buyerProductRequester.send({
            type: 'get-wishlist-count',
            body: { buyer_uuid },
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'get-wishlist-count',
                method: 'POST',
                payload: req.query,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-wishlist-count:", err.message);
        await saveErrorLog({
            api_name: 'get-wishlist-count',
            method: 'POST',
            payload: req.query,
            message: err.message,
            stack: err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message,
        });
    }
});

// --------------------------------------------------
// BUYER QUOTE ACCEPTANCE
// --------------------------------------------------

router.post('/accept-buyer-quote', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'accept-buyer-quote',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'accept-buyer-quote',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in accept-buyer-quote:", err.message);
        await saveErrorLog({
            api_name: 'accept-buyer-quote',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message,
        });
    }
});

// --------------------------------------------------
// BUYER QUOTE REJECTION
// --------------------------------------------------

router.post('/reject-buyer-quote', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'reject-buyer-quote',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name: 'reject-buyer-quote',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in reject-buyer-quote:", err.message);
        await saveErrorLog({
            api_name: 'reject-buyer-quote',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004,
        });
        res.status(500).json({
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message,
        });
    }
});


// --------------------------------------------------
// SEARCH BRANDS (autocomplete)
// --------------------------------------------------
router.post('/car-search-brand', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({ type: 'search-car-brands', body: req.body });
        if (!result.status) {
            await saveErrorLog({ api_name: 'search-car-brands', method: 'POST', payload: req.body, message: result.error, stack: result.stack || '', error_code: result.code || 2004 });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in search-car-brands:", err.message);
        await saveErrorLog({ api_name: 'search-car-brands', method: 'POST', payload: req.body, message: err.message, stack: err.stack, error_code: 2004 });
        res.status(500).json({ header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: err.message, error: err.message });
    }
});

// --------------------------------------------------
// SEARCH MODELS (autocomplete)
// --------------------------------------------------
router.post('/car-search-model', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({ type: 'search-car-models', body: req.body });
        if (!result.status) {
            await saveErrorLog({ api_name: 'search-car-models', method: 'POST', payload: req.body, message: result.error, stack: result.stack || '', error_code: result.code || 2004 });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in search-car-models:", err.message);
        await saveErrorLog({ api_name: 'search-car-models', method: 'POST', payload: req.body, message: err.message, stack: err.stack, error_code: 2004 });
        res.status(500).json({ header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: err.message, error: err.message });
    }
});

// --------------------------------------------------
// SEARCH VARIANTS (autocomplete)
// --------------------------------------------------
router.post('/car-search-variant', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({ type: 'search-car-variants', body: req.body });
        if (!result.status) {
            await saveErrorLog({ api_name: 'search-car-variants', method: 'POST', payload: req.body, message: result.error, stack: result.stack || '', error_code: result.code || 2004 });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in search-car-variants:", err.message);
        await saveErrorLog({ api_name: 'search-car-variants', method: 'POST', payload: req.body, message: err.message, stack: err.stack, error_code: 2004 });
        res.status(500).json({ header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: err.message, error: err.message });
    }
});

// --------------------------------------------------
// CREATE VEHICLE PROFILE
// --------------------------------------------------
router.post('/create-car', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({ type: 'create-car-profile', body: req.body });
        if (!result.status) {
            await saveErrorLog({ api_name: 'create-car-profile', method: 'POST', payload: req.body, message: result.error, stack: result.stack || '', error_code: result.code || 2004 });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in create-car-profile:", err.message);
        await saveErrorLog({ api_name: 'create-car-profile', method: 'POST', payload: req.body, message: err.message, stack: err.stack, error_code: 2004 });
        res.status(500).json({ header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: err.message, error: err.message });
    }
});

// --------------------------------------------------
// GET ALL VEHICLES FOR BUYER
// --------------------------------------------------
router.post('/car-list', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({ type: 'get-buyer-cars', body: req.body });
        if (!result.status) {
            await saveErrorLog({ api_name: 'get-buyer-cars', method: 'POST', payload: req.body, message: result.error, stack: result.stack || '', error_code: result.code || 2004 });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-buyer-cars:", err.message);
        await saveErrorLog({ api_name: 'get-buyer-cars', method: 'POST', payload: req.body, message: err.message, stack: err.stack, error_code: 2004 });
        res.status(500).json({ header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: err.message, error: err.message });
    }
});

// --------------------------------------------------
// GET SPECIFIC VEHICLE PROFILE
// --------------------------------------------------
router.post('/car-detail/:car_management_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'get-car-details',
            body: { ...req.body, car_management_uuid: req.params.car_management_uuid },
        });
        if (!result.status) {
            await saveErrorLog({ api_name: 'get-car-details', method: 'POST', payload: req.body, message: result.error, stack: result.stack || '', error_code: result.code || 2004 });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-car-details:", err.message);
        await saveErrorLog({ api_name: 'get-car-details', method: 'POST', payload: req.body, message: err.message, stack: err.stack, error_code: 2004 });
        res.status(500).json({ header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: err.message, error: err.message });
    }
});

// --------------------------------------------------
// UPDATE VEHICLE PROFILE
// --------------------------------------------------
router.post('/car-update/:car_management_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'update-car-profile',
            body: { ...req.body, car_management_uuid: req.params.car_management_uuid },
        });
        if (!result.status) {
            await saveErrorLog({ api_name: 'update-car-profile', method: 'POST', payload: req.body, message: result.error, stack: result.stack || '', error_code: result.code || 2004 });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in update-car-profile:", err.message);
        await saveErrorLog({ api_name: 'update-car-profile', method: 'POST', payload: req.body, message: err.message, stack: err.stack, error_code: 2004 });
        res.status(500).json({ header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: err.message, error: err.message });
    }
});

// --------------------------------------------------
// SOFT DELETE VEHICLE PROFILE
// --------------------------------------------------
router.post('/car-delete/:car_management_uuid', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'delete-car-profile',
            body: { ...req.body, car_management_uuid: req.params.car_management_uuid },
        });
        if (!result.status) {
            await saveErrorLog({ api_name: 'delete-car-profile', method: 'POST', payload: req.body, message: result.error, stack: result.stack || '', error_code: result.code || 2004 });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in delete-car-profile:", err.message);
        await saveErrorLog({ api_name: 'delete-car-profile', method: 'POST', payload: req.body, message: err.message, stack: err.stack, error_code: 2004 });
        res.status(500).json({ header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: err.message, error: err.message });
    }
});

// --------------------------------------------------
// GET PRODUCTS BY CAR
// --------------------------------------------------

router.post('/get-products-by-vehicle', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({ type: 'get-products-by-vehicle', body: req.body });
        if (!result.status) {
            await saveErrorLog({ api_name: 'get-products-by-vehicle', method: 'POST', payload: req.body, message: result.error, stack: result.stack || '', error_code: result.code || 2004 });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in get-products-by-vehicle:", err.message);
        await saveErrorLog({ api_name: 'get-products-by-vehicle', method: 'POST', payload: req.body, message: err.message, stack: err.stack, error_code: 2004 });
        res.status(500).json({ header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: err.message, error: err.message });
    }
});


// --------------------------------------------------
// CHECKOUT INITIATE — QUOTE FLOW
// --------------------------------------------------
router.post('/checkout-initiate-quote', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'checkout-initiate-quote',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'checkout-initiate-quote',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in checkout-initiate-quote:", err.message);
        await saveErrorLog({
            api_name:   'checkout-initiate-quote',
            method:     'POST',
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

// --------------------------------------------------
// CREATE QUOTE FOR BUYER — FROM PRODUCT LISTING 
// --------------------------------------------------
router.post('/quote-create-from-listing-buyer', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'create-buyer-quote-listing-buyer',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'create-buyer-quote-listing-buyer',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in create-buyer-quote-listing-buyer:", err.message);
        await saveErrorLog({
            api_name:   'create-buyer-quote-listing-buyer',
            method:     'POST',
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

// --------------------------------------------------
// CREATE QUOTE FOR CUSTOMER BY BUYER — FROM PRODUCT LISTING
// --------------------------------------------------

router.post('/quote-create-from-listing-customer', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'create-buyer-quote-listing-customer',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'create-buyer-quote-listing-customer',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in create-buyer-quote-listing-customer:", err.message);
        await saveErrorLog({
            api_name:   'create-buyer-quote-listing-customer',
            method:     'POST',
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

// ------------------------------------------------------------------
// QUOTE ACCEPTANCE FOR BUYER AND CUSTOMER   — FROM PRODUCT LISTING
// ------------------------------------------------------------------
router.post('/quote-accept-listing', async (req, res) => {
    try {
        const result = await buyerProductRequester.send({
            type: 'accept-buyer-quote-listing',
            body: req.body,
        });
        if (!result.status) {
            await saveErrorLog({
                api_name:   'accept-buyer-quote-listing',
                method:     'POST',
                payload:    req.body,
                message:    result.error,
                stack:      result.stack || '',
                error_code: result.code || 2004,
            });
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error("Error in accept-buyer-quote-listing:", err.message);
        await saveErrorLog({
            api_name:   'accept-buyer-quote-listing',
            method:     'POST',
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

module.exports = router;
