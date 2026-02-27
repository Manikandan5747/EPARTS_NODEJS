require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'rejection-reasons responder',
    key: 'rejection-reasons',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key:'rejection-reasons',
    table: 'rejection_reasons',
    alias: 'PT',
    uuidColumn: 'rejection_reason_uuid',
    allowedFields: ['code', 'name', 'is_active','description', 'created_at', 'modified_at']
});

module.exports = responder;