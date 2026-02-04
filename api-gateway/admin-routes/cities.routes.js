require('module-alias/register');

const express = require('express');
const router = express.Router();
const cityRequester = require('@libs/requesters/admin-requesters/cities-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');

// --------------------------------------
// CREATE CITY
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await cityRequester.send({
            type: 'create-city',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-city',
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
        logger.error('Error in cities/create:', err.message);
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
// LIST ALL CITIES
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await cityRequester.send({ type: 'list-city' });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-city',
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
        logger.error('Error in cities/list:', err.message);
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
// FIND CITY BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await cityRequester.send({
            type: 'getById-city',
            city_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-city',
                method: 'GET',
                payload: { city_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in cities/findbyid:', err.message);
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
// UPDATE CITY
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await cityRequester.send({
            type: 'update-city',
            city_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-city',
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
        logger.error('Error in cities/update:', err.message);
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
// DELETE CITY
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await cityRequester.send({
            type: 'delete-city',
            city_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-city',
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
        logger.error('Error in cities/delete:', err.message);
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
        const result = await cityRequester.send({
            type: 'status-city',
            city_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-city',
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
        logger.error('Error in cities/status:', err.message);
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
        const result = await cityRequester.send({
            type: 'advancefilter-city',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-city',
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
        logger.error('Error in cities/pagination-list:', err.message);
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
// CLONE CITY
// --------------------------------------
router.post('/clone/:id', async (req, res) => {
    try {
        const result = await cityRequester.send({
            type: 'clone-city',
            city_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'clone-city',
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
        logger.error('Error in cities/clone:', err.message);
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
// FIND COUNTRY_ID BY ID
// --------------------------------------
router.get('/countryid/:id', async (req, res) => {
    try {
        const result = await cityRequester.send({
            type: 'getById-city-countryid',
            country_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-city-countryid',
                method: 'GET',
                payload: { country_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in states countryid/findbyid:', err.message);
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
// FIND STATE_ID BY ID
// --------------------------------------
router.get('/stateid/:id', async (req, res) => {
    try {
        const result = await cityRequester.send({
            type: 'getById-city-stateid',
            state_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-city-stateid',
                method: 'GET',
                payload: { state_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in states state_uuid/findbyid:', err.message);
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
// FIND STATE_ID BY ID
// --------------------------------------
router.get('/stateid/:id', async (req, res) => {
    try {
        const result = await cityRequester.send({
            type: 'getById-city-stateid',
            state_uuid: req.params.id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'getById-city-stateid',
                method: 'GET',
                payload: { state_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error('Error in states state_uuid/findbyid:', err.message);
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
// STATE LIST BY COUNTRY UUID
// --------------------------------------
router.get("/listpagination", async (req, res) => {
    try {
        const {
            state_uuid,
            search = "",
            page = 1,
            limit = 10
        } = req.query;

        if (!state_uuid) {
            return res.status(400).json({
                status: false,
                code: 2001,
                error: "state_uuid is required"
            });
        }

        const result = await cityRequester.send({
            type: "city-list",
            state_uuid,
            search,
            page: Number(page),
            limit: Number(limit)
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: "city-list",
                method: "GET",
                payload: { state_uuid, search, page, limit },
                message: result.error,
                stack: result.stack || "",
                error_code: result.code || 2004
            });

            return res.status(500).json(result);
        }

        return res.status(200).json(result);

    } catch (err) {
        logger.error("Error in /state/list:", err);
        return res.status(500).json({
            status: false,
            code: 2004,
            error: err.message
        });
    }
});

module.exports = router;