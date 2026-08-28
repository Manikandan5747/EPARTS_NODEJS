const express = require('express');
const router = express.Router();
const partsRequester = require('@libs/requesters/admin-requesters/parts-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
const uploadDir = path.join('/app/assets', 'parts');
const multipartMiddleware = multipart({ uploadDir });
const multer = require('multer');

// ----------------------------------------------------------------
// PART FILE SAVE
// ----------------------------------------------------------------
router.post('/filesave', multipartMiddleware, async (req, res) => {
    try {
        const result = await partsRequester.send({
            type : 'part-filesave',
            body : req.body,
            files: req.files
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'part-filesave',
                method    : 'POST',
                payload   : req.body,
                message   : result.error,
                stack     : result.stack || '',
                error_code: result.code  || 2004
            });
            return res.status(400).json(result);
        }

        return res.status(200).json(result);

    } catch (err) {
        logger.error("Error in parts/filesave:", err.message);
        await saveErrorLog({
            api_name  : 'part-filesave',
            method    : 'POST',
            payload   : req.body,
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        return res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Internal server error",
            error             : err.message
        });
    }
});

// ----------------------------------------------------------------
// CREATE PART
// ----------------------------------------------------------------
router.post('/create', multipartMiddleware, async (req, res) => {
    try {

        let images = req.body.images || [];
        if (typeof images === 'string') {
            try { images = JSON.parse(images); } catch { images = []; }
        }

        // -------------------------------------------------------
        // Parse supersession object if sent as JSON string
        // -------------------------------------------------------
        let supersession = req.body.supersession || null;
        if (typeof supersession === 'string') {
            try { supersession = JSON.parse(supersession); } catch { supersession = null; }
        }

        const result = await partsRequester.send({
            type: 'create-part',
            body: {
                ...req.body,
                images,
                supersession
                //,
                // is_superseded  : req.body.is_superseded   === 'true' || req.body.is_superseded   === true,
                // is_universal   : req.body.is_universal    === 'true' || req.body.is_universal    === true,
                // is_service_item: req.body.is_service_item === 'true' || req.body.is_service_item === true
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'create-part',
                method    : 'POST',
                payload   : req.body,
                message   : result.error,
                stack     : result.stack || '',
                error_code: result.code  || 2004
            });
            return res.status(400).json(result);
        }

        return res.status(201).json(result);

    } catch (err) {
        logger.error("Error in parts/create:", err.message);
        await saveErrorLog({
            api_name  : 'create-part',
            method    : 'POST',
            payload   : req.body,
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        return res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Internal server error",
            error             : err.message
        });
    }
});

// ----------------------------------------------------------------
// UPDATE PART
// ----------------------------------------------------------------
router.post('/update/:part_uuid', multipartMiddleware, async (req, res) => {
    try {
        const { part_uuid } = req.params;

        let images = req.body.images || [];
        if (typeof images === 'string') {
            try { images = JSON.parse(images); } catch { images = []; }
        }

        // -------------------------------------------------------
        // Parse supersession object if sent as JSON string
        // -------------------------------------------------------
        let supersession = req.body.supersession || null;
        if (typeof supersession === 'string') {
            try { supersession = JSON.parse(supersession); } catch { supersession = null; }
        }

        // -------------------------------------------------------
        // Parse deleted_image_uuids if sent as JSON string
        // -------------------------------------------------------
        let deleted_image_uuids = req.body.deleted_image_uuids || [];
        if (typeof deleted_image_uuids === 'string') {
            try { deleted_image_uuids = JSON.parse(deleted_image_uuids); } catch { deleted_image_uuids = []; }
        }

        const result = await partsRequester.send({
            type     : 'update-part',
            part_uuid,
            body     : {
                ...req.body,
                images,
                supersession,
                deleted_image_uuids,
                is_superseded  : req.body.is_superseded   === 'true' || req.body.is_superseded   === true,
                is_universal   : req.body.is_universal    === 'true' || req.body.is_universal    === true,
                is_service_item: req.body.is_service_item === 'true' || req.body.is_service_item === true,
                status         : req.body.status === 'true'          || req.body.status          === true
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'update-part',
                method    : 'POST',
                payload   : { part_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack || '',
                error_code: result.code  || 2004
            });
            return res.status(400).json(result);
        }

        return res.status(200).json(result);

    } catch (err) {
        logger.error("Error in parts/update:", err.message);
        await saveErrorLog({
            api_name  : 'update-part',
            method    : 'POST',
            payload   : { part_uuid: req.params.part_uuid, ...req.body },
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        return res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Internal server error",
            error             : err.message
        });
    }
});

// ----------------------------------------------------------------
// GET PART BY UUID
// ----------------------------------------------------------------
router.get('/findbyid/:part_uuid', async (req, res) => {
    try {
        const { part_uuid } = req.params;

        const result = await partsRequester.send({
            type     : 'getById-part',
            part_uuid,
            body: { user_id: req.body.user_id, mode: req.body.mode }

        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'getById-part',
                method    : 'GET',
                payload   : { part_uuid },
                message   : result.error,
                stack     : result.stack || '',
                error_code: result.code  || 2004
            });
            const httpCode = result.code === 2003 ? 404
                           : result.code === 2005 ? 423   // 423 Locked
                           : 400;
            return res.status(httpCode).json(result);
        }

        return res.status(200).json(result);

    } catch (err) {
        logger.error("Error in parts/getById:", err.message);
        await saveErrorLog({
            api_name  : 'getById-part',
            method    : 'GET',
            payload   : { part_uuid: req.params.part_uuid },
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        return res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Internal server error",
            error             : err.message
        });
    }
});


// ----------------------------------------------------------------
// DELETE PART (SOFT DELETE)
// ----------------------------------------------------------------
router.post('/delete/:part_uuid', async (req, res) => {
    try {
        const { part_uuid } = req.params;

        const result = await partsRequester.send({
            type     : 'delete-part',
            part_uuid,
            body     : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'delete-part',
                method    : 'POST',
                payload   : { part_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack || '',
                error_code: result.code  || 2004
            });
            const httpCode = result.code === 2003 ? 404 : 400;
            return res.status(httpCode).json(result);
        }

        return res.status(200).json(result);

    } catch (err) {
        logger.error("Error in parts/delete:", err.message);
        await saveErrorLog({
            api_name  : 'delete-part',
            method    : 'POST',
            payload   : { part_uuid: req.params.part_uuid, ...req.body },
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        return res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Internal server error",
            error             : err.message
        });
    }
});


// ----------------------------------------------------------------
// STATUS TOGGLE — PART
// ----------------------------------------------------------------
router.post('/status/:part_uuid', async (req, res) => {
    try {
        const { part_uuid } = req.params;

        const result = await partsRequester.send({
            type     : 'status-part',
            part_uuid,
            body     : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'status-part',
                method    : 'POST',
                payload   : { part_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack || '',
                error_code: result.code  || 2004
            });
            const httpCode = result.code === 2003 ? 404 : 400;
            return res.status(httpCode).json(result);
        }

        return res.status(200).json(result);

    } catch (err) {
        logger.error("Error in parts/status:", err.message);
        await saveErrorLog({
            api_name  : 'status-part',
            method    : 'POST',
            payload   : { part_uuid: req.params.part_uuid, ...req.body },
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        return res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Internal server error",
            error             : err.message
        });
    }
});


// ----------------------------------------------------------------
// UNLOCK PART RECORD
// ----------------------------------------------------------------
router.post('/unlock/:part_uuid', async (req, res) => {
    try {
        const { part_uuid } = req.params;

        const result = await partsRequester.send({
            type     : 'unlock-part',
            part_uuid,
            body     : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'unlock-part',
                method    : 'POST',
                payload   : { part_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack || '',
                error_code: result.code  || 2004
            });
            const httpCode = result.code === 2003 ? 404 : 400;
            return res.status(httpCode).json(result);
        }

        return res.status(200).json(result);

    } catch (err) {
        logger.error("Error in parts/unlock:", err.message);
        await saveErrorLog({
            api_name  : 'unlock-part',
            method    : 'POST',
            payload   : { part_uuid: req.params.part_uuid, ...req.body },
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        return res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Internal server error",
            error             : err.message
        });
    }
});


// ----------------------------------------------------------------
// ADVANCED FILTER — PARTS
// ----------------------------------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await partsRequester.send({
            type           : 'advancefilter-parts',
            dataAccessScope: req.dataAccessScope || null,
            body           : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'advancefilter-parts',
                method    : 'POST',
                payload   : req.body,
                message   : result.error,
                stack     : result.stack || '',
                error_code: result.code  || 2004
            });
            return res.status(400).json(result);
        }

        return res.status(200).json(result);

    } catch (err) {
        logger.error("Error in parts/filter:", err.message);
        await saveErrorLog({
            api_name  : 'advancefilter-parts',
            method    : 'POST',
            payload   : req.body,
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        return res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Internal server error",
            error             : err.message
        });
    }
});




// --------------------------------------
// CREATE CAR
// --------------------------------------

router.post('/create-car', async (req, res) => {
    try {

        const result = await partsRequester.send({
            type: 'create-car',
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-car',
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
        logger.error("Error in car/create:", err.message);
        await saveErrorLog({
            api_name: 'create-car',
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
// GET CAR BY UUID
// --------------------------------------
router.get('/findbyid-car/:car_uuid', async (req, res) => {
    try {
        const result = await partsRequester.send({
            type    : 'getById-car',
            car_uuid: req.params.car_uuid,
            body    : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'getById-car',
                method    : 'GET',
                payload   : { car_uuid: req.params.car_uuid },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'getById-car',
            method    : 'GET',
            payload   : { car_uuid: req.params.car_uuid },
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


// --------------------------------------
// UPDATE CAR
// --------------------------------------
router.post('/update-car/:car_uuid', async (req, res) => {
    try {
        const result = await partsRequester.send({
            type    : 'update-car',
            car_uuid: req.params.car_uuid,
            body    : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'update-car',
                method    : 'POST',
                payload   : { car_uuid: req.params.car_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'update-car',
            method    : 'POST',
            payload   : { car_uuid: req.params.car_uuid, ...req.body },
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


// --------------------------------------
// DELETE CAR
// --------------------------------------
router.post('/delete-car/:car_uuid', async (req, res) => {
    try {
        const result = await partsRequester.send({
            type    : 'delete-car',
            car_uuid: req.params.car_uuid,
            body    : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'delete-car',
                method    : 'POST',
                payload   : { car_uuid: req.params.car_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'delete-car',
            method    : 'POST',
            payload   : { car_uuid: req.params.car_uuid, ...req.body },
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


// --------------------------------------
// STATUS TOGGLE — CAR
// --------------------------------------
router.post('/status-car/:car_uuid', async (req, res) => {
    try {
        const result = await partsRequester.send({
            type    : 'status-car',
            car_uuid: req.params.car_uuid,
            body    : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'status-car',
                method    : 'POST',
                payload   : { car_uuid: req.params.car_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'status-car',
            method    : 'POST',
            payload   : { car_uuid: req.params.car_uuid, ...req.body },
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


// --------------------------------------
// UNLOCK CAR RECORD
// --------------------------------------
router.post('/unlock-car/:car_uuid', async (req, res) => {
    try {
        const result = await partsRequester.send({
            type    : 'unlock-car',
            car_uuid: req.params.car_uuid,
            body    : req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'unlock-car',
                method    : 'POST',
                payload   : { car_uuid: req.params.car_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack,
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        await saveErrorLog({
            api_name  : 'unlock-car',
            method    : 'POST',
            payload   : { car_uuid: req.params.car_uuid, ...req.body },
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

// --------------------------------------
// ADVANCE FILTER LIST — CARS
// --------------------------------------
router.post('/pagination-list-car', async (req, res) => {
    try {
        const result = await partsRequester.send({
            type: 'advancefilter-cars',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name  : 'advancefilter-cars',
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
            api_name  : 'advancefilter-cars',
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

// ----------------------------------------------------------------
// DELETE PART SUPERSESSION (SOFT DELETE)
// ----------------------------------------------------------------
router.post('/delete-supersession/:part_supersession_uuid', async (req, res) => {
    try {
        const { part_supersession_uuid } = req.params;
        const result = await partsRequester.send({
            type                  : 'delete-part-supersession',
            part_supersession_uuid,
            body                  : req.body
        });
        if (!result.status) {
            await saveErrorLog({
                api_name  : 'delete-part-supersession',
                method    : 'POST',
                payload   : { part_supersession_uuid, ...req.body },
                message   : result.error,
                stack     : result.stack || '',
                error_code: result.code  || 2004
            });
            const httpCode = result.code === 2003 ? 404 : 400;
            return res.status(httpCode).json(result);
        }
        return res.status(200).json(result);
    } catch (err) {
        logger.error("Error in parts/supersession/delete:", err.message);
        await saveErrorLog({
            api_name  : 'delete-part-supersession',
            method    : 'POST',
            payload   : { part_supersession_uuid: req.params.part_supersession_uuid, ...req.body },
            message   : err.message,
            stack     : err.stack,
            error_code: 2004
        });
        return res.status(500).json({
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : "Internal server error",
            error             : err.message
        });
    }
});

module.exports = router;
