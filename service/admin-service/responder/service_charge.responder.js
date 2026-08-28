require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'service_charge responder',
    key: 'service_charge',
    redis: { host: redisHost, port: 6379 }
});
registerMasterResponder({
    responder,
    pool,
    key: 'service_charge',
    table: 'service_charge',
    alias: 'CS',
    uuidColumn: 'service_charge_uuid',
    allowedFields: ['code', 'name','charge_type','default_amount', 'is_active', 'created_at', 'modified_at', 'assigned_at']
});
module.exports = responder;