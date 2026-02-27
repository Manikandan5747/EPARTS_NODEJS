const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/master-data-requesters/package_type-requester');

module.exports = createMasterRoutes({
    requester,
    entityName: 'package_type'
});







