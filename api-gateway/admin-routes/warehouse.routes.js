const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/warehouse-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'warehouse',
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
        },
        city_uuid: {
            table: 'cities',
            uuidColumn: 'city_uuid',
            idColumn: 'city_id',
            targetField: 'city_id'
        },
                cms_company_info_uuid: {
            table: 'cms_company_info',
            uuidColumn: 'cms_company_info_uuid',
            idColumn: 'cms_company_info_id',
            targetField: 'cms_company_info_id'
        }

    },
    fileFields: [],
    uploadFolder: '',
    filterKey:'state_uuid'
});


