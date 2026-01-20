const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/manufacturer-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'manufacturer'
});






