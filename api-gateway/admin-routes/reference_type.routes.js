const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/reference_type-requester');
module.exports = createMasterRoutes({
    requester,
    entityName: 'reference_type'
});