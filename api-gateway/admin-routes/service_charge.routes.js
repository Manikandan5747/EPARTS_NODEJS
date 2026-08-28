const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/service_charge-requester');
module.exports = createMasterRoutes({
    requester,
    entityName: 'service_charge'
});