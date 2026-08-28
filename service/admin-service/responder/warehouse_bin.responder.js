require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'warehouse_bin responder',
    key: 'warehouse_bin',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key: 'warehouse_bin',
    table: 'warehouse_bin',
    alias: 'PT',
    uuidColumn: 'warehouse_bin_uuid',
    allowedFields: ['code', 'name', 'is_active', 'created_at', 'modified_at',],
    dateFields: [],
    customFields: {
        warehouse_name: {
            select: 'CO.name',
            search: 'CO.name',
            sort: 'CO.name'
        }
        
    },

    joinSql: `
        LEFT JOIN warehouse CO ON PT.warehouse_id = CO.warehouse_id`

});

module.exports = responder;