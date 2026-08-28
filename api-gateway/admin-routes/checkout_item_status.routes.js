const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/checkout_item_status-requester');
module.exports = createMasterRoutes({
    requester,
    entityName: 'checkout_item_status'
});