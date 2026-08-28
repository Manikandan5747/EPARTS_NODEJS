require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'checkout_type responder',
    key: 'checkout_type',
    redis: { host: redisHost, port: 6379 }
});
registerMasterResponder({
    responder,
    pool,
    key: 'checkout_type',
    table: 'checkout_type',
    alias: 'WT',
    uuidColumn: 'checkout_type_uuid',
    allowedFields: ['code', 'name', 'is_active', 'created_at', 'modified_at']
});
module.exports = responder;