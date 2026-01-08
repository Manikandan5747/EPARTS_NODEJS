const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/tax_code_master-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'tax_code_master'
});







