require('module-alias/register');

const express = require('express');
const router = express.Router();
const roleRequester = require('@libs/requesters/roles-requester');
const logger = require('@libs/logger/logger');



// --------------------------------------
// CREATE ROLE
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'create-role',
            body: req.body
        });
        res.status(201).send(result);
    } catch (err) {
        logger.error("Error in roles/create:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// LIST ALL ROLES
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await roleRequester.send({ type: 'list-role' });
        res.send(result);
    } catch (err) {
        logger.error("Error in roles/list:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// FIND ROLE BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'getById-role',
            role_uuid: req.params.id
        });
        res.json(result);
    } catch (err) {
        logger.error("Error in roles/findbyid:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// UPDATE ROLE (Corrected Endpoint)
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'update-role',
            role_uuid: req.params.id,
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in roles/update:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// DELETE ROLE
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'delete-role',
            role_uuid: req.params.id,
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in roles/delete:", err.message);
        res.status(500).json({ error: err.message });
    }
});



// --------------------------------------
// STATUS CHANGE
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'status-role',
            role_uuid: req.params.id,
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in roles/delete:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// ADVANCE FILTER LIST API
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const roles = await roleRequester.send({
            type: 'advancefilter-role',
            body: req.body
        });
        res.json(roles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// CLONE ROLE
// --------------------------------------
router.post('/clone/:id', async (req, res) => {
    try {
        const result = await roleRequester.send({
            type: 'clone-role',
            role_uuid: req.params.id,
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in roles/clone:", err.message);
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;
