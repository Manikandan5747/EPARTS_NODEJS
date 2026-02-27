const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/master-data-requesters/prefix_refno-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'prefix_refno'
});






