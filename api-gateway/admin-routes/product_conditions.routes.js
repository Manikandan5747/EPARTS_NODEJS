const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/product_conditions-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'product_conditions'
});






