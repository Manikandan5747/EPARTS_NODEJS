require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');


const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const responder = new cote.Responder({
    name: 'cities responder',
    key: 'cities',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key: 'cities',
    table: 'cities',
    alias: 'PT',
    uuidColumn: 'city_uuid',
    allowedFields: ['code', 'name', 'is_active', 'created_at', 'modified_at',],
    dateFields: [],
    customFields: {
        country_name: {
            select: 'CO.name',
            search: 'CO.name',
            sort: 'CO.name'
        },
        state_name: {
            select: 'ST.name',
            search: 'ST.name',
            sort: 'ST.name'
        }
    },

    joinSql: `
        LEFT JOIN countries CO ON PT.country_id = CO.country_id
        LEFT JOIN states ST ON PT.state_id = ST.state_id`
});

module.exports = responder;
