const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/product-types-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'product-types'
});






