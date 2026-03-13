require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'uom responder',
    key: 'uom',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key:'uom',
    table: 'uom',
    alias: 'PT',
    uuidColumn: 'uom_uuid',
    allowedFields: ['code', 'name','description','symbol', 'is_active','description', 'created_at', 'modified_at']
});

module.exports = responder;