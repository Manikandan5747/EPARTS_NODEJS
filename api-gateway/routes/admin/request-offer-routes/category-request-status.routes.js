const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin/request-offer-requesters/category-request-status-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'category-request-status',
    foreignKeyMap: {},
    fileFields: [],
    uploadFolder: ''
});