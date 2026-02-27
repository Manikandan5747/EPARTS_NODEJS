require('module-alias/register');
const express = require('express');
const router = express.Router();

const roleRoutes = require('../../routes/admin/iam-routes/roles.routes');
const roleDataAccessRoutes = require('../../routes/admin/iam-routes/role-data-access.routes');
const profileRoutes = require('../../routes/admin/iam-routes/profile.routes');
const userRoutes = require('../../routes/admin/iam-routes/users.routes');

router.use('/role', roleRoutes);
router.use('/role-data-access', roleDataAccessRoutes);
router.use('/profile', profileRoutes);
router.use('/user', userRoutes);

module.exports = router;