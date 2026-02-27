const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/order-quote-requesters/order_statuses-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'order_statuses'
});






