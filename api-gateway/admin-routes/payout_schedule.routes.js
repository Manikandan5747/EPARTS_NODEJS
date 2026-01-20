const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/payout_schedule-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'payout_schedule'
});






