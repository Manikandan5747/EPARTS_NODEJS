require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'web_version responder',
    key: 'web_version',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key:'web_version',
    table: 'webversion',
    alias: 'PT',
    uuidColumn: 'web_version_uuid',
    allowedFields: ['web_category', 'web_version','company_name', 'is_active', 'created_at', 'modified_at']
});

module.exports = responder;