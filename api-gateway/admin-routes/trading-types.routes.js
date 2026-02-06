const createMasterRoutes = require('@libs/common/master.routes.factory');
const requester = require('@libs/requesters/admin-requesters/trading-type-requester');


module.exports = createMasterRoutes({
    requester,
    entityName: 'trading_types'
});
