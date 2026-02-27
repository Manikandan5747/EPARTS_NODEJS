require('module-alias/register');
const express = require('express');
const router = express.Router();

const orderStatusRoutes = require('../../routes/admin/order-quote-routes/order_statuses.routes');
const orderTypeRoutes = require('../../routes/admin/order-quote-routes/order_type.routes');
const quoteStatusRoutes = require('../../routes/admin/order-quote-routes/quote_statuses.routes');
const refundStatusRoutes = require('../../routes/admin/order-quote-routes/refund_statuses.routes');
const shipmentStatusRoutes = require('../../routes/admin/order-quote-routes/shipment_statuses.routes');
const makeOfferStatusRoutes = require('../../routes/admin/order-quote-routes/make_offer_status.routes');
const partsRequestStatuseRoutes = require('../../routes/admin/order-quote-routes/parts_request_statuses.routes');

router.use('/order-status', orderStatusRoutes);
router.use('/order-type', orderTypeRoutes);
router.use('/quote-status', quoteStatusRoutes);
router.use('/refund-status', refundStatusRoutes);
router.use('/shipment-status', shipmentStatusRoutes);
router.use('/make-offer-status', makeOfferStatusRoutes);
router.use('/parts-request-status', partsRequestStatuseRoutes);

module.exports = router;