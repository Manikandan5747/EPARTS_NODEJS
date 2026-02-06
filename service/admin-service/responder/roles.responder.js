require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'user_role responder',
    key: 'user_role',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key: 'user_role',
    table: 'user_role',
    alias: 'PT',
    uuidColumn: 'rejection_reason_uuid',
    allowedFields: ['hierarchy_level', 'role_name', 'is_active', 'created_at', 'modified_at']
});

module.exports = responder;