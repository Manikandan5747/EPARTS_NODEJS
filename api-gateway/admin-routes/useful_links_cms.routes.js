const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/useful_links_cms-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'useful_links_cms'
});







