const router = (() => require('express'))().Router();

router.use('/roles', (req, res, next) => require('../admin-routes/roles.routes.js')(req, res, next));

router.use('/user-type', (req, res, next) => require('../admin-routes/user-type.routes.js')(req, res, next));

router.use('/users', (req, res, next) => require('../admin-routes/users.routes.js')(req, res, next));

router.use('/portal-users', (req, res, next) => require('../admin-routes/portal-user.routes.js')(req, res, next));

router.use('/country', (req, res, next) => require('../admin-routes/countries.routes.js')(req, res, next));

router.use('/state', (req, res, next) => require('../admin-routes/states.routes.js')(req, res, next));

router.use('/city', (req, res, next) => require('../admin-routes/cities.routes.js')(req, res, next));

router.use('/currency', (req, res, next) => require('../admin-routes/currency.routes.js')(req, res, next));

router.use('/setting', (req, res, next) => require('../admin-routes/settings.routes.js')(req, res, next));

router.use('/trading-type', (req, res, next) => require('../admin-routes/trading-types.routes.js')(req, res, next));

router.use('/product-type', (req, res, next) => require('../admin-routes/product-types.routes.js')(req, res, next));

router.use('/payment-mode', (req, res, next) => require('../admin-routes/payment-modes.routes.js')(req, res, next));


router.use('/registration-status', (req, res, next) => require('../admin-routes/registration-status.routes.js')(req, res, next));

router.use('/registration-fail-reasons', (req, res, next) => require('../admin-routes/registration-fail-reasons.routes.js')(req, res, next));


router.use('/product-listing-status', (req, res, next) => require('../admin-routes/product-listing-status.routes.js')(req, res, next));


router.use('/rejection-reasons', (req, res, next) => require('../admin-routes/rejection-reasons.routes.js')(req, res, next));


router.use('/category-request-status', (req, res, next) => require('../admin-routes/category-request-status.routes.js')(req, res, next));

router.use('/order-statuses', (req, res, next) => require('../admin-routes/order_statuses.routes.js')(req, res, next));

router.use('/parts-request-statuses', (req, res, next) => require('../admin-routes/parts_request_statuses.routes.js')(req, res, next));

router.use('/payment-statuses', (req, res, next) => require('../admin-routes/payment_statuses.routes.js')(req, res, next));

router.use('/quote-statuses', (req, res, next) => require('../admin-routes/quote_statuses.routes.js')(req, res, next));

router.use('/refund-statuses', (req, res, next) => require('../admin-routes/refund_statuses.routes.js')(req, res, next));

router.use('/shipment-statuses', (req, res, next) => require('../admin-routes/shipment_statuses.routes.js')(req, res, next));

router.use('/make-offer-status', (req, res, next) => require('../admin-routes/make_offer_status.routes.js')(req, res, next));

router.use('/product_listing_statuses', (req, res, next) => require('../admin-routes/product_listing_statuses.routes.js')(req, res, next));

router.use('/order_type', (req, res, next) => require('../admin-routes/order_type.routes.js')(req, res, next));

router.use('/package_type', (req, res, next) => require('../admin-routes/package_type.routes.js')(req, res, next));

router.use('/jurisdiction', (req, res, next) => require('../admin-routes/jurisdiction.routes.js')(req, res, next));

router.use('/tax_code_master', (req, res, next) => require('../admin-routes/tax_code_master.routes.js')(req, res, next));


router.use('/manufacturer', (req, res, next) => require('../admin-routes/manufacturer.routes.js')(req, res, next));

router.use('/account_type', (req, res, next) => require('../admin-routes/account_type.routes.js')(req, res, next));

router.use('/address_type_master', (req, res, next) => require('../admin-routes/address_type_master.routes.js')(req, res, next));

router.use('/document_type_master', (req, res, next) => require('../admin-routes/document_type_master.routes.js')(req, res, next));

router.use('/payout_schedule', (req, res, next) => require('../admin-routes/payout_schedule.routes.js')(req, res, next));

router.use('/product_conditions', (req, res, next) => require('../admin-routes/product_conditions.routes.js')(req, res, next));

router.use('/model', (req, res, next) => require('../admin-routes/model.routes.js')(req, res, next));

router.use('/module', (req, res, next) => require('../admin-routes/module.routes.js')(req, res, next));

router.use('/profile-privilege', (req, res, next) => require('../admin-routes/profile-privilege.routes.js')(req, res, next));



 

// Testing
router.use('/dynamic-report', (req, res, next) => require('../admin-routes/report.routes.js')(req, res, next));

module.exports = router;
