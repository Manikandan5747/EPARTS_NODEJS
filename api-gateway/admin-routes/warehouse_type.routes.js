const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/warehouse_type-requester');
module.exports = createMasterRoutes({
    requester,
    entityName: 'warehouse_type'
});