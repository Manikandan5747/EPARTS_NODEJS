const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/make_offer_status');


module.exports = createMasterRoutes({
    requester,
    entityName: 'make_offer_status'
});







