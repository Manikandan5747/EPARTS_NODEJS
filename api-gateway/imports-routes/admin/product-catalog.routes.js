require('module-alias/register');
const express = require('express');
const router = express.Router();

const brandRoutes = require('../../routes/admin/product-catalog-routes/brand.routes');
const modelRoutes = require('../../routes/admin/product-catalog-routes/model.routes');
const productListingStatusRoutes = require('../../routes/admin/product-catalog-routes/product-listing-status.routes');
const productTypeRoutes = require('../../routes/admin/product-catalog-routes/product-types.routes');
const manufacturerRoutes = require('../../routes/admin/product-catalog-routes/manufacturer.routes.js');
const productConditionRoutes = require('../../routes/admin/product-catalog-routes/product_conditions.routes.js');

router.use('/brand', brandRoutes);
router.use('/model', modelRoutes);
router.use('/product-listing-status', productListingStatusRoutes);
router.use('/product-type', productTypeRoutes);
router.use('/manufacturer', manufacturerRoutes);
router.use('/product-condition', productConditionRoutes);

module.exports = router;