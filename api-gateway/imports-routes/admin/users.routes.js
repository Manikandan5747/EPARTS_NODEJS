require('module-alias/register');
const express = require('express');
const router = express.Router();

// const manageBuyerRoutes = require('../../routes/admin/users-routes/buyer.routes');
// const manageSellerRoutes = require('../../routes/admin/users-routes/seller.routes');
const userTypeRoutes = require('../../routes/admin/users-routes/user-type.routes');
const userRoutes = require('../../routes/admin/users-routes/users.routes');
const registrationStatusRoutes = require('../../routes/admin/users-routes/registration-status.routes');
const registrationFailReasonRoutes = require('../../routes/admin/users-routes/registration-fail-reasons.routes');
const portalUserRoutes = require('../../routes/admin/users-routes/portal-user.routes');

// router.use('/manage-buyer', manageBuyerRoutes);
// router.use('/manage-seller', manageSellerRoutes);
router.use('/user-type', userTypeRoutes);
router.use('/user', userRoutes);
router.use('/registration-status', registrationStatusRoutes);
router.use('/registration-fail-reason', registrationFailReasonRoutes);
router.use('/portal-user', portalUserRoutes);

module.exports = router;