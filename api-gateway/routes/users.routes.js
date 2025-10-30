const express = require('express');
const router = express.Router();
const usersRequester = require('@libs/requesters/users-requester');
const logger = require('@libs/logger/logger');
// List all users
router.get('/listallusers', async (req, res) => {
  try {
    console.log("listallusers");
    logger.info("list")
    
    const users = await usersRequester.send({ type: 'list' });
      console.log("createusers",users);
    res.send(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
