require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const registerMasterResponder = require('@libs/common/master.responder.factory');
const logger = require('@libs/logger/logger');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const responder = new cote.Responder({
    name: 'cms_homepage_about_section responder',
    key: 'cms_homepage_about_section',
    redis: { host: redisHost, port: 6379 }
});

registerMasterResponder({
    responder,
    pool,
    key:'cms_homepage_about_section',
    table: 'cms_homepage_about_section',
    alias: 'PT',
    uuidColumn: 'cms_about_uuid',
    allowedFields: ['title', 'sub_title','content','redirect_link', 'is_active', 'created_at', 'modified_at'],
    searchableFields: ['title', 'sub_title','content','redirect_link']
});

module.exports = responder;
