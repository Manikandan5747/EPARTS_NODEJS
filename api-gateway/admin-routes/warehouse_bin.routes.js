const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/warehouse_bin-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'warehouse_bin',
    foreignKeyMap: {
        warehouse_uuid: {
            table: 'warehouse',
            uuidColumn: 'warehouse_uuid',
            idColumn: 'warehouse_id',
            targetField: 'warehouse_id'
        }
        

    },
    fileFields: [],
    uploadFolder: '',
    filterKey:'warehouse_uuid'
});


