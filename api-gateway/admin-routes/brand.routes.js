const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/brand-requester');

module.exports = createMasterRoutes({
    requester,
    entityName: 'brand',
    foreignKeyMap: {},
    fileFields: ['logo_path'],
    uploadFolder: 'brands'
});