require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const responder = new cote.Responder({
    name: 'settings responder',
    key: 'settings',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key:'settings',
    table: 'settings',
    alias: 'PT',
    uuidColumn: 'setting_uuid',
    allowedFields: ['setcategory', 'setparameter','setparametervalue','settingdate','settingexpirydate', 'is_active','description', 'created_at', 'modified_at'],
    dateFields: ['settingdate','settingexpirydate'],
});

module.exports = responder;