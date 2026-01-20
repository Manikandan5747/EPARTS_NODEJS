const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/model-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'model'
});






