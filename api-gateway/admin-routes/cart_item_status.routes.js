const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/cart_item_status-requester');
module.exports = createMasterRoutes({
    requester,
    entityName: 'cart_item_status'
});