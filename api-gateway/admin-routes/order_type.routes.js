const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/order_type-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'order_type'
});







