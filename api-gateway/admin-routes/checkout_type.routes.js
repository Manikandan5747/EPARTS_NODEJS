const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/checkout_type-requester');
module.exports = createMasterRoutes({
    requester,
    entityName: 'checkout_type'
});