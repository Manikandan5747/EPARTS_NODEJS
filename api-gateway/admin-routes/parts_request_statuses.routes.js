const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/parts_request_statuses-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'parts_request_statuses'
});






