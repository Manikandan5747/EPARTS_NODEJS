require('module-alias/register');
const express = require('express');
const router = express.Router();

const paymentModeRoutes = require('../../routes/admin/payment-finance-routes/payment-modes.routes');
const paymentStatusRoutes = require('../../routes/admin/payment-finance-routes/payment_statuses.routes');
const paymentTypeRoutes = require('../../routes/admin/payment-finance-routes/payment-type.routes'); 
const taxCodeRoutes = require('../../routes/admin/payment-finance-routes/tax_code_master.routes');
const payoutScheduleRoutes = require('../../routes/admin/payment-finance-routes/payout_schedule.routes');

router.use('/payment-mode', paymentModeRoutes);
router.use('/payment-status', paymentStatusRoutes);
router.use('/payment-type', paymentTypeRoutes);
router.use('/tax-code', taxCodeRoutes);
router.use('/payout-schedule', payoutScheduleRoutes);

module.exports = router;