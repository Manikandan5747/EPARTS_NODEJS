const express = require('express');
const router = express.Router();
const roleRequester = require('@libs/requesters/role-requester');
const logger = require('@libs/logger/logger');

// List all role
router.get('/listallrole', async (req, res) => {
  try { logger.info("listallrole")
    const roles = await roleRequester.send({ type: 'list' });
    logger.info("roles",roles)
    res.send(roles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
