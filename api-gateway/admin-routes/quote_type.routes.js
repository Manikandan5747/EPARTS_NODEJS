const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/quote_type-requester');
module.exports = createMasterRoutes({
    requester,
    entityName: 'quote_type'
});