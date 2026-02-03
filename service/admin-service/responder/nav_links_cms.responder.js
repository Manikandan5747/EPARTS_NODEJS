require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');
const logger = require('@libs/logger/logger');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const responder = new cote.Responder({
    name: 'nav_links_cms responder',
    key: 'nav_links_cms',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key:'nav_links_cms',
    table: 'nav_links_cms',
    alias: 'PT',
    uuidColumn: 'nav_links_cms_uuid',
    allowedFields: ['label', 'link', 'is_active', 'created_at', 'modified_at'],
    searchableFields: ['label', 'link']
});

module.exports = responder;
