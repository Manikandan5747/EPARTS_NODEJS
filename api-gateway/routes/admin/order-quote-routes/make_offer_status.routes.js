const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/order-quote-requesters/make_offer_status-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'make_offer_status'
});







