require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'payout_schedule responder',
    key: 'payout_schedule',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key:'payout_schedule',
    table: 'payout_schedule',
    alias: 'PT',
    uuidColumn: 'payout_schedule_uuid',
    allowedFields: ['code', 'name', 'is_active', 'created_at', 'modified_at']
});

module.exports = responder;