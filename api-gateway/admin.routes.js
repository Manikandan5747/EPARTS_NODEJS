require('module-alias/register');

const express = require('express');
const router = express.Router();


router.use('/roles', require('./routes/roles.routes.js'));
router.use('/user-type', require('./routes/user-type.routes.js'));
router.use('/users', require('./routes/users.routes.js'));

module.exports = router;
