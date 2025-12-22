require('module-alias/register');

const express = require('express');
const router = express.Router();
const usertypeRequester = require('@libs/requesters/admin-requesters/user-type-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


// --------------------------------------
// CREATE USER TYPE
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await usertypeRequester.send({
            type: 'create-usertype',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'create-usertype',
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
        logger.error("Error in usertype/create:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// LIST ALL USER TYPE
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await usertypeRequester.send({ type: 'list-usertype' });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'list-usertype',
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
        logger.error("Error in usertype/list:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// FIND USER TYPE BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await usertypeRequester.send({
            type: 'getById-usertype',
            role_uuid: req.params.id
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'getById-usertype',
                method: 'GET',
                payload: { role_uuid: req.params.id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.json(result);

    } catch (err) {
        logger.error("Error in usertype/findbyid:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// UPDATE USER TYPE
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await usertypeRequester.send({
            type: 'update-usertype',
            role_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'update-usertype',
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
        logger.error("Error in usertype/update:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// DELETE USER TYPE
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await usertypeRequester.send({
            type: 'delete-usertype',
            role_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'delete-usertype',
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
        logger.error("Error in usertype/delete:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// STATUS CHANGE USER TYPE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await usertypeRequester.send({
            type: 'status-usertype',
            role_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'status-usertype',
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
        logger.error("Error in usertype/status:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// ADVANCE FILTER LIST API USER TYPE
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const result = await usertypeRequester.send({
            type: 'advancefilter-usertype',
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'advancefilter-usertype',
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
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// CLONE USER TYPE
// --------------------------------------
router.post('/clone/:id', async (req, res) => {
    try {
        const result = await usertypeRequester.send({
            type: 'clone-usertype',
            role_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'clone-usertype',
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
        logger.error("Error in usertype/clone:", err.message);
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;
