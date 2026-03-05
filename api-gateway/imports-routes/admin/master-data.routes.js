require('module-alias/register');
const express = require('express');
const router = express.Router();
const apiAccess = require('@libs/JWT/data-access-control-api.js');

const countryRoutes = require('../../routes/admin/master-data-routes/countries.routes');
// const stateRoutes = require('../../routes/admin/master-data-routes/states.routes');
const cityRoutes = require('../../routes/admin/master-data-routes/cities.routes');
const currencyRoutes = require('../../routes/admin/master-data-routes/currency.routes');
const tradingTypeRoutes = require('../../routes/admin/master-data-routes/trading-types.routes');
const packageTypeRoutes = require('../../routes/admin/master-data-routes/package_type.routes');
const jurisdictionRoutes = require('../../routes/admin/master-data-routes/jurisdiction.routes');
const accountTypeRoutes = require('../../routes/admin/master-data-routes/account_type.routes');
const documentTypeRoutes = require('../../routes/admin/master-data-routes/document_type_master.routes');
const moduleRoutes = require('../../routes/admin/master-data-routes/module.routes');
const settingRoutes = require('../../routes/admin/master-data-routes/settings.routes');
const prefixRefnoRoutes = require('../../routes/admin/master-data-routes/prefix_refno.routes');
const webVersionRoutes = require('../../routes/admin/master-data-routes/web_version.routes');
const addressTypeRoutes = require('../../routes/admin/master-data-routes/address_type_master.routes.js');

router.use('/country', countryRoutes);
// router.use('/state', stateRoutes);
router.use('/city', cityRoutes);
router.use('/currency', currencyRoutes);
router.use('/trading-type', tradingTypeRoutes);
router.use('/package-type', packageTypeRoutes);
router.use('/jurisdiction', jurisdictionRoutes);
router.use('/account-type', accountTypeRoutes);
router.use('/document-type', documentTypeRoutes);
router.use('/module', moduleRoutes);
router.use('/setting', settingRoutes);
router.use('/prefix-refno', prefixRefnoRoutes);
router.use('/web-version', webVersionRoutes);
router.use('/address-type', addressTypeRoutes);


module.exports = router;