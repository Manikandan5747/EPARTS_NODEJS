require('module-alias/register');

const express = require('express');
const router = express.Router();

router.use('/buyer-users', require('../buyer-routes/users.routes'));
module.exports = router;
