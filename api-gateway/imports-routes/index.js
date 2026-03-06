require('module-alias/register');

// API AUTHENTICATION – ACCESS TOKEN CHECKING FOR EACH REQUEST
// const AdminStartAuthApi = require("@libs/JWT/admin-auth-api");
// const BuyerStartAuthApi = require("@libs/JWT/buyer-auth-api");
// const SellerStartAuthApi = require("@libs/JWT/seller-auth-api");

// ---------------- ADMIN ROUTES ----------------
const AdminIAMRoutes = require('./admin/iam.routes');
const AdminUserRoutes = require('./admin/users.routes');
const AdminProductRoutes = require('./admin/product-catalog.routes');
const AdminOrderRoutes = require('./admin/order-quote.routes');
const AdminPaymentRoutes = require('./admin/payment-finance.routes');
const AdminInventoryRoutes = require('./admin/inventory.routes');
const AdminNotificationRoutes = require('./admin/notification.routes');
const AdminSubscriptionRoutes = require('./admin/subscription.routes');
const AdminReportingRoutes = require('./admin/reporting.routes');
const AdminRequestOfferRoutes = require('./admin/request-offer.routes');
const AdminMasterRoutes = require('./admin/master-data.routes');
const AdminIntegrationRoutes = require('./admin/integration.routes');
const AdminCMSRoutes = require('./admin/cms.routes');

// ---------------- BUYER ROUTES ----------------
const BuyerIAMRoutes = require('./buyer/iam.routes');
const BuyerUserRoutes = require('./buyer/users.routes');
const BuyerProductRoutes = require('./buyer/product.routes');
const BuyerCartRoutes = require('./buyer/cart.routes');
const BuyerOrderRoutes = require('./buyer/order-routes');
const BuyerQuoteRoutes = require('./buyer/quote-routes');
const BuyerPaymentRoutes = require('./buyer/payment-finance.routes');
const BuyerInventoryRoutes = require('./buyer/inventory.routes');
const BuyerNotificationRoutes = require('./buyer/notification.routes');
const BuyerSubscriptionRoutes = require('./buyer/subscription.routes');
const BuyerReportingRoutes = require('./buyer/reporting.routes');
const BuyerRequestOfferRoutes = require('./buyer/request-offer.routes');
const BuyerIntegrationRoutes = require('./buyer/integration.routes');

// ---------------- SELLER ROUTES ----------------
const SellerIAMRoutes = require('./seller/iam.routes');
const SellerUserRoutes = require('./seller/users.routes');
const SellerProductRoutes = require('./seller/product-catalog.routes');
const SellerOrderRoutes = require('./seller/order-quote.routes');
const SellerPaymentRoutes = require('./seller/payment-finance.routes');
const SellerInventoryRoutes = require('./seller/inventory.routes');
const SellerNotificationRoutes = require('./seller/notification.routes');
const SellerSubscriptionRoutes = require('./seller/subscription.routes');
const SellerReportingRoutes = require('./seller/reporting.routes');
const SellerRequestOfferRoutes = require('./seller/request-offer.routes');
const SellerIntegrationRoutes = require('./seller/integration.routes');

module.exports = function registerRoutes(app, middlewares) {
    const {  checkApiKey,assignAssignedTo } = middlewares;

    /* ---------------- ADMIN FLOW ---------------- */
    app.use('/api', checkApiKey ,assignAssignedTo, AdminIAMRoutes);
    app.use('/api', checkApiKey ,assignAssignedTo, AdminUserRoutes);
    app.use('/api', checkApiKey ,assignAssignedTo, AdminProductRoutes);
    app.use('/api', checkApiKey ,assignAssignedTo, AdminOrderRoutes);
    app.use('/api', checkApiKey ,assignAssignedTo, AdminPaymentRoutes);
    app.use('/api', checkApiKey ,assignAssignedTo, AdminInventoryRoutes);
    app.use('/api', checkApiKey ,assignAssignedTo, AdminNotificationRoutes);
    app.use('/api', checkApiKey ,assignAssignedTo, AdminSubscriptionRoutes);
    app.use('/api', checkApiKey ,assignAssignedTo, AdminReportingRoutes);
    app.use('/api', checkApiKey ,assignAssignedTo, AdminRequestOfferRoutes);
    app.use('/api', checkApiKey ,assignAssignedTo, AdminMasterRoutes);
    app.use('/api', checkApiKey ,assignAssignedTo, AdminIntegrationRoutes);
    app.use('/api', checkApiKey ,assignAssignedTo, AdminCMSRoutes);

    // /* ---------------- BUYER FLOW ---------------- */
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerIAMRoutes);
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerUserRoutes);
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerProductRoutes);
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerCartRoutes);
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerOrderRoutes);
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerQuoteRoutes);
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerPaymentRoutes);
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerInventoryRoutes);
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerNotificationRoutes);
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerSubscriptionRoutes);
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerReportingRoutes);
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerRequestOfferRoutes);
    app.use('/api/buyer', checkApiKey, assignAssignedTo, BuyerIntegrationRoutes);

    // /* ---------------- SELLER FLOW ---------------- */
    app.use('/api/seller', checkApiKey, assignAssignedTo, SellerIAMRoutes);
    app.use('/api/seller', checkApiKey, assignAssignedTo, SellerUserRoutes);
    app.use('/api/seller', checkApiKey, assignAssignedTo, SellerProductRoutes);
    app.use('/api/seller', checkApiKey, assignAssignedTo, SellerOrderRoutes);
    app.use('/api/seller', checkApiKey, assignAssignedTo, SellerPaymentRoutes);
    app.use('/api/seller', checkApiKey, assignAssignedTo, SellerInventoryRoutes);
    app.use('/api/seller', checkApiKey, assignAssignedTo, SellerNotificationRoutes);
    app.use('/api/seller', checkApiKey, assignAssignedTo, SellerSubscriptionRoutes);
    app.use('/api/seller', checkApiKey, assignAssignedTo, SellerReportingRoutes);
    app.use('/api/seller', checkApiKey, assignAssignedTo, SellerRequestOfferRoutes);
    app.use('/api/seller', checkApiKey, assignAssignedTo, SellerIntegrationRoutes);
};