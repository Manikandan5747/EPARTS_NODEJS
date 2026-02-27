require('module-alias/register');

const express = require('express');
const router = express.Router();

const sellerUserRoutes = require('../../routes/seller/users-routes/users.routes');

router.use('/seller-users', sellerUserRoutes);

module.exports = router;