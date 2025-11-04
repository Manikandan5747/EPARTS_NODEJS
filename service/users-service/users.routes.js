const express = require('express');
const router = express.Router();
const usersRequester = require('@libs/requesters/users-requester');
const logger = require('@libs/logger/logger');


// List all users
router.get('/listalluser', async (req, res) => {
  try {
    console.log("listallusers");
    logger.info("list")
    
    const users = await usersRequester.send({ type: 'list' });
      // console.log("createusers",users);
    res.send(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// Get user by ID
router.get('/usergetById/:id', async (req, res) => {
  try {
      console.log("usergetById");
    logger.info("usergetById")
    const user = await usersRequester.send({
      type: 'getById',
      id: req.params.id
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// Get user by ID
router.get('/find/:id', async (req, res) => {
  try {
      console.log("usergetById");
    logger.info("usergetById")
    const user = await usersRequester.send({
      type: 'getById',
      id: req.params.id
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// delete user by ID
router.get('/deleteById/:id', async (req, res) => {
  try {
     
    const user = await usersRequester.send({
      type: 'delete',
      id: req.params.id
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
