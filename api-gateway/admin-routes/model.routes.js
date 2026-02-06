const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/model-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'model',
    foreignKeyMap: {
        brand_uuid: {
            table: 'brand',
            uuidColumn: 'brand_uuid',
            idColumn: 'brand_id',
            targetField: 'brand_id'
        }
    },
    fileFields: [], // single image
    uploadFolder : ''
});






