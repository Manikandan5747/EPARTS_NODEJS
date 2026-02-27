require('module-alias/register');
const express = require('express');
const router = express.Router();

const categoryRequestStatusRoutes = require('../../routes/admin/request-offer-routes/category-request-status.routes');
const rejectionReasonRoutes = require('../../routes/admin/request-offer-routes/rejection-reasons.routes');

router.use('/category-request-status', categoryRequestStatusRoutes);
router.use('/rejection-reason', rejectionReasonRoutes);

module.exports = router;