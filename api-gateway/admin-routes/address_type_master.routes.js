const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/address_type_master-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'address_type_master'
});






