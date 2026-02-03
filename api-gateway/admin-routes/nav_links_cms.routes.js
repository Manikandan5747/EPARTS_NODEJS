const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/nav_links_cms-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'nav_links_cms'
});







