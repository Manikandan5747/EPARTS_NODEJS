const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/payment-finance-requesters/payment_type-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'payment_type'
});
