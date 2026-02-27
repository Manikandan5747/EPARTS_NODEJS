const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/master-data-requesters/jurisdiction-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'jurisdiction'
});







