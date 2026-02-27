require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'model responder',
    key: 'model',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key: 'model',
    table: 'model',
    alias: 'PT',
    uuidColumn: 'model_uuid',
    allowedFields: ['code', 'name', 'is_active', 'created_at', 'modified_at'],
    dateFields: [],
    customFields: {
        brand_name: {
            select: 'BD.name',
            search: 'BD.name',
            sort: 'BD.name'
        }
    },

    joinSql: `
        LEFT JOIN brand BD
            ON PT.brand_id = BD.brand_id`
});

module.exports = responder;