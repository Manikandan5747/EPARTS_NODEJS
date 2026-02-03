const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/cms_homepage_about_section-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'cms_homepage_about_section'
});







