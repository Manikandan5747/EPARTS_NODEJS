const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/registration-status-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'registration-status'
});






