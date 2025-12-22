require('module-alias/register');

const express = require('express');
const router = express.Router();

router.use('/seller-users', require('../seller-routes/users.routes'));


module.exports = router;
