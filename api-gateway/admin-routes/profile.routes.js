require('module-alias/register');

const express = require('express');
const router = express.Router();
const profileRequester = require('@libs/requesters/admin-requesters/profile-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


// --------------------------------------
// CREATE PROFILE
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await profileRequester.send({
            type: 'create-profile',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-profile',
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
        logger.error("Error in profile/create:", err.message);
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
// LIST ALL PROFILES
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await profileRequester.send({
            type: 'list-profile'
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-profile',
                method: 'GET',
                payload: null,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error("Error in profile/list:", err.message);
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
// FIND PROFILE BY ID
// --------------------------------------
// router.get('/findbyid/:id', async (req, res) => {
//     try {
//         const result = await profileRequester.send({
//             type: 'getById-profile',
//             profile_uuid: req.params.id
//         });

//         if (!result.status) {
//             await saveErrorLog({
//                 api_name: 'getById-profile',
//                 method: 'GET',
//                 payload: { profile_uuid: req.params.id },
//                 message: result.error,
//                 stack: result.stack || '',
//                 error_code: result.code || 2004
//             });
//             return res.status(500).json(result);
//         }

//         res.json(result);

//     } catch (err) {
//         logger.error("Error in profile/findbyid:", err.message);
//         res.status(500).json({
//     header_type: "ERROR",
//     message_visibility: true,
//     status: false,
//     code: 2004,
//     message: err.message,
//     error: err.message
// });
//     }
// });


// --------------------------------------
// UPDATE PROFILE
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await profileRequester.send({
            type: 'update-profile',
            profile_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'update-profile',
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
        logger.error("Error in profile/update:", err.message);
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
// DELETE PROFILE (SOFT DELETE)
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await profileRequester.send({
            type: 'delete-profile',
            profile_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'delete-profile',
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
        logger.error("Error in profile/delete:", err.message);
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
// STATUS CHANGE (ACTIVE / INACTIVE)
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await profileRequester.send({
            type: 'status-profile',
            profile_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'status-profile',
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
        logger.error("Error in profile/status:", err.message);
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
// ADVANCE FILTER + PAGINATION
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await profileRequester.send({
            type: 'advancefilter-profile',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'advancefilter-profile',
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
        logger.error("Error in profile/pagination:", err.message);
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


/* ======================================================
   LIST BY moduletypelist
====================================================== */
router.get('/moduletypelist', async (req, res) => {
    try {
        const { module_type } = req.query;
        const result = await profileRequester.send({
            type: 'moduletypelist',
            module_type: module_type
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'moduletypelist',
                method: 'GET',
                payload: { module_type: module_type },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        return res.json(result);

    } catch (err) {
        logger.error("Error in moduletypelist/list:", err.message);
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
// FIND PROFILE BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {

        const mode = req.query.mode || 'view';
        const user_id = req.query.user_id;

        const result = await profileRequester.send({
            type: 'getById-profile',
            profile_uuid: req.params.id,
            mode,
            body: { user_id }
        });
        // If responder returned  server error → return HTTP 500
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'getById-profile',
                method: 'GET',
                payload: { profile_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in profile/findbyid:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// UNLOCK RECORD (SAVE / CANCEL)
// --------------------------------------

router.post('/unlock/:id', async (req, res) => {
    try {
        const result = await profileRequester.send({
            type: `unlock-profile`,
            uuid: req.params.id,
            body: { user_id: req.body.user_id }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: `unlock-profile`,
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

module.exports = router;
