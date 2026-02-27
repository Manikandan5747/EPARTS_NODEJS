const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/iam-requesters/roles-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'user_role'
});