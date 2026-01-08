require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');
const logger = require('@libs/logger/logger');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const responder = new cote.Responder({
    name: 'registration-fail-reasons responder',
    key: 'registration-fail-reasons',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key:'registration-fail-reasons',
    table: 'registration_fail_reasons',
    alias: 'PT',
    uuidColumn: 'registration_fail_reason_uuid',
    allowedFields: ['code', 'name', 'is_active','description', 'created_at', 'modified_at']
});

module.exports = responder;
