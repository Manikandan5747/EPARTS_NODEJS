const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/jurisdiction-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'jurisdiction'
});







