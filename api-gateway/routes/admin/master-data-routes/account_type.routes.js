const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/master-data-requesters/account_type-requester');

module.exports = createMasterRoutes({
    requester,
    entityName: 'account_type',
    foreignKeyMap: {},
    fileFields: [],
    uploadFolder: ''
});