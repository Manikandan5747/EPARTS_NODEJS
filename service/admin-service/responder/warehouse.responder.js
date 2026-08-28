require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'warehouse responder',
    key: 'warehouse',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key: 'warehouse',
    table: 'warehouse',
    alias: 'PT',
    uuidColumn: 'warehouse_uuid',
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
        },
        city_name: {
            select: 'CT.name',
            search: 'CT.name',
            sort: 'CT.name'
        },
         company_name: {
            select: 'CC.company_name',
            search: 'CC.company_name',
            sort: 'CC.company_name'
        }
    },

    joinSql: `
        LEFT JOIN countries CO ON PT.country_id = CO.country_id
        LEFT JOIN states ST ON PT.state_id = ST.state_id
        LEFT JOIN cities CT ON PT.city_id = CT.city_id
        LEFT JOIN cms_company_info CC ON PT.cms_company_info_id = CC.cms_company_info_id
`

});

module.exports = responder;