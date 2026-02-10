require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'states responder',
    key: 'states',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key: 'states',
    table: 'states',
    alias: 'PT',
    uuidColumn: 'state_uuid',
    allowedFields: ['code', 'name', 'is_active', 'created_at', 'modified_at',],
    dateFields: [],
    customFields: {
        country_name: {
            select: 'CO.name',
            search: 'CO.name',
            sort: 'CO.name'
        }
    },

    joinSql: `
        LEFT JOIN countries CO ON PT.country_id = CO.country_id
       `
});

module.exports = responder;