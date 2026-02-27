const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/master-data-requesters/currency-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'currency'
});