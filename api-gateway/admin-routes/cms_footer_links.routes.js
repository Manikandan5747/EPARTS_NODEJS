const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/cms_footer_links-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'cms_footer_links'
});






