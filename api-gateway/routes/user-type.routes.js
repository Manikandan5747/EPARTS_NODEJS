require('module-alias/register');

const express = require('express');
const router = express.Router();
const usertypeRequester = require('@libs/requesters/user-type-requester');
const logger = require('@libs/logger/logger');



// --------------------------------------
// CREATE USER TYPE
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await usertypeRequester.send({
            type: 'create-usertype',
            body: req.body
        });
        res.status(201).send(result);
    } catch (err) {
        logger.error("Error in user type/create:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// LIST ALL USER TYPE
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await usertypeRequester.send({ type: 'list-usertype' });
        res.send(result);
    } catch (err) {
        logger.error("Error in user type/list:", err.message);
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
        res.json(result);
    } catch (err) {
        logger.error("Error in user type/findbyid:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// UPDATE USER TYPE (Corrected Endpoint)
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await usertypeRequester.send({
            type: 'update-usertype',
            role_uuid: req.params.id,
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in user type/update:", err.message);
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
        res.send(result);
    } catch (err) {
        logger.error("Error in user type/delete:", err.message);
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
        res.send(result);
    } catch (err) {
        logger.error("Error in user type/delete:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// ADVANCE FILTER LIST API USER TYPE
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const roles = await usertypeRequester.send({
            type: 'advancefilter-usertype',
            body: req.body
        });
        res.json(roles);
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
        res.send(result);
    } catch (err) {
        logger.error("Error in user type/clone:", err.message);
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;
