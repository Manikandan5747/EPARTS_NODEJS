const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/payment_statuses-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'payment_statuses'
});






