const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/countries-requester');

module.exports = createMasterRoutes({
    requester,
    entityName: 'countries',
    foreignKeyMap: {
        currency_uuid: {
            table: 'currency',
            uuidColumn: 'currency_uuid',
            idColumn: 'currency_id',
            targetField: 'currency_id'
        }
    },
    fileFields: ['flag_icon_path'], // single image
    uploadFolder : 'brands'
});






