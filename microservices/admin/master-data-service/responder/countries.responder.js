require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'countries responder',
    key: 'countries',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key: 'countries',
    table: 'countries',
    alias: 'PT',
    uuidColumn: 'country_uuid',
    allowedFields: ['code', 'name', 'country_code', 'description', 'is_active', 'created_at', 'modified_at',],
    dateFields: [],
    customFields: {
        currency_name: {
            select: 'CU.name',
            search: 'CU.name',
            sort: 'CU.name'
        }
    },

    joinSql: `
        LEFT JOIN currency CU ON PT.currency_id = CU.currency_id
        `
});

module.exports = responder;