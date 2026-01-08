const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/shipment_statuses-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'shipment_statuses'
});







