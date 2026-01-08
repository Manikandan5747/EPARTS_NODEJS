require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');
const logger = require('@libs/logger/logger');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const responder = new cote.Responder({
    name: 'make_offer_status responder',
    key: 'make_offer_status',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key:'make_offer_status',
    table: 'make_offer_status',
    alias: 'PT',
    uuidColumn: 'make_offer_status_uuid',
    allowedFields: ['code', 'name', 'is_active', 'created_at', 'modified_at']
});

module.exports = responder;
