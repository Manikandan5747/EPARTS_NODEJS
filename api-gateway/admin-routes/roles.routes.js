const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/roles-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'user_role'
});