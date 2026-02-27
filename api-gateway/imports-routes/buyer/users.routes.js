require('module-alias/register');

const express = require('express');
const router = express.Router();

const buyerUserRoutes = require('../../routes/buyer/users-routes/users.routes');

router.use('/buyer-users', buyerUserRoutes);

module.exports = router;