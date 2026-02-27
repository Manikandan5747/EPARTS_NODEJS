require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'jurisdiction responder',
    key: 'jurisdiction',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key: 'jurisdiction',
    table: 'jurisdiction',
    alias: 'PT',
    uuidColumn: 'jurisdiction_uuid',
    allowedFields: ['code', 'name', 'is_active', 'created_at', 'modified_at'],
    dateFields: ['last_integrated_date'],
    customFields: {
        parent_jurisdiction_name: {
            select: 'JM.name',
            search: 'JM.name',
            sort: 'JM.name'
        }
    },

    joinSql: `
        LEFT JOIN jurisdiction JM
            ON PT.jurisdiction_uuid = JM.parent_jurisdiction`
});

module.exports = responder;