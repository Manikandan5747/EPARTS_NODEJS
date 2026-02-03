const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/web_version-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'web_version'
});







