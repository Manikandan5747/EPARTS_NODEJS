require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'prefix_refno responder',
    key: 'prefix_refno',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key:'prefix_refno',
    table: 'prefix_refno',
    alias: 'PT',
    uuidColumn: 'prefix_refno_uuid',
    allowedFields: ['category_type', 'table_name','id_field','ref_field','prefix_code', 'is_active', 'created_at', 'modified_at'],
    searchableFields: ['category_type', 'table_name', 'prefix_code']
});

module.exports = responder;