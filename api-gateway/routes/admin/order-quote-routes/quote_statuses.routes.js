const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/order-quote-requesters/quote_statuses-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'quote_statuses'
});







