const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/rejection-reasons-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'rejection-reasons'
});