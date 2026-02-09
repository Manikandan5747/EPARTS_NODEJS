const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/states-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'states',
    foreignKeyMap: {
        country_uuid: {
            table: 'countries',
            uuidColumn: 'country_uuid',
            idColumn: 'country_id',
            targetField: 'country_id'
        }
    },
    fileFields: [],
    uploadFolder: '',
    filterKey: 'country_uuid'
});