require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');
const logger = require('@libs/logger/logger');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const responder = new cote.Responder({
    name: 'cms_footer_links responder',
    key: 'cms_footer_links',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key:'cms_footer_links',
    table: 'cms_footer_links',
    alias: 'PT',
    uuidColumn: 'cms_footer_link_uuid',
    allowedFields: ['link_name', 'redirect_link', 'is_active', 'created_at', 'modified_at']
});

module.exports = responder;
