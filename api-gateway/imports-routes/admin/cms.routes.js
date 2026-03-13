require('module-alias/register');
const express = require('express');
const router = express.Router();

const cmsRoutes = require('../../routes/admin/cms-routes/cms.routes');


router.use('/cms', cmsRoutes);


module.exports = router;