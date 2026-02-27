const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/master-data-requesters/address_type_master-requester');
module.exports = createMasterRoutes({
    requester,
    entityName: 'address_type_master',
    foreignKeyMap: {},
    fileFields: [],
    uploadFolder: ''
});