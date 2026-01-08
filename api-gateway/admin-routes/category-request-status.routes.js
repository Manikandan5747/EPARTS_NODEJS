const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/category-request-status-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'category-request-status'
});






