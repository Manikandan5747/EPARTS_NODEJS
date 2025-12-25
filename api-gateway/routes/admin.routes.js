const router = (() => require('express'))().Router();

router.use('/roles', (req, res, next) => require('../admin-routes/roles.routes.js')(req, res, next));

router.use('/user-type', (req, res, next) => require('../admin-routes/user-type.routes.js')(req, res, next));

router.use('/users', (req, res, next) => require('../admin-routes/users.routes.js')(req, res, next));

router.use('/portal-users', (req, res, next) => require('../admin-routes/portal-user.routes.js')(req, res, next));

router.use('/country', (req, res, next) => require('../admin-routes/countries.routes.js')(req, res, next));

router.use('/state', (req, res, next) => require('../admin-routes/states.routes.js')(req, res, next));

router.use('/city', (req, res, next) => require('../admin-routes/cities.routes.js')(req, res, next));


router.use('/product-types', (req, res, next) => require('../admin-routes/product-types.routes.js')(req, res, next));

// Testing
router.use('/dynamic-report', (req, res, next) => require('../admin-routes/report.routes.js')(req, res, next));

module.exports = router;
