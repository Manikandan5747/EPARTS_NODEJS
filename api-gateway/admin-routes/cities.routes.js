const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/cities-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'cities',
    foreignKeyMap: {
        country_uuid: {
            table: 'countries',
            uuidColumn: 'country_uuid',
            idColumn: 'country_id',
            targetField: 'country_id'
        },
        state_uuid: {
            table: 'states',
            uuidColumn: 'state_uuid',
            idColumn: 'state_id',
            targetField: 'state_id'
        }
    },
    fileFields: [],
    uploadFolder: '',
    filterKey:'state_uuid'
});


