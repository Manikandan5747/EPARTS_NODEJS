const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/refund_statuses-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'refund_statuses'
});







