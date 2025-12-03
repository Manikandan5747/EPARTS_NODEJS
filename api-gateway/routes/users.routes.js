require('module-alias/register');

const express = require('express');
const router = express.Router();
const usersRequester = require('@libs/requesters/users-requester');
const logger = require('@libs/logger/logger');



// --------------------------------------
// CREATE USERS
// --------------------------------------
router.post('/create', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'create-users',
            body: req.body
        });
        res.status(201).send(result);
    } catch (err) {
        logger.error("Error in users/create:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// LIST ALL USERS
// --------------------------------------
router.get('/list', async (req, res) => {
    try {
        const result = await usersRequester.send({ type: 'list-users' });
        res.send(result);
    } catch (err) {
        logger.error("Error in users/list:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// FIND USERS BY ID
// --------------------------------------
router.get('/findbyid/:id', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'getById-users',
            user_uuid: req.params.id
        });
        res.json(result);
    } catch (err) {
        logger.error("Error in users/findbyid:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// UPDATE USERS (Corrected Endpoint)
// --------------------------------------
router.post('/update/:id', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'update-users',
            user_uuid: req.params.id,
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in users/update:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// DELETE USERS
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'delete-users',
            user_uuid: req.params.id,
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in users/delete:", err.message);
        res.status(500).json({ error: err.message });
    }
});



// --------------------------------------
// STATUS CHANGE USERS
// --------------------------------------
router.post('/status/:id', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'status-users',
            user_uuid: req.params.id,
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in users/delete:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// ADVANCE FILTER LIST API
// --------------------------------------
router.post('/pagination-list', async (req, res) => {
    try {
        const users = await usersRequester.send({
            type: 'advancefilter-users',
            body: req.body
        });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// --------------------------------------
// CLONE USERS
// --------------------------------------
router.post('/clone/:id', async (req, res) => {
    try {
        const result = await usersRequester.send({
            type: 'clone-users',
            user_uuid: req.params.id,
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in users/clone:", err.message);
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;
