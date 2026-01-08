const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/registration-fail-reasons-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'registration-fail-reasons'
});






