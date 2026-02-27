const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/user-requesters/user-type-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'user_types'
});