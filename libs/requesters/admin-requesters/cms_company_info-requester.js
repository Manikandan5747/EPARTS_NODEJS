const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const cmsCompanyInfoRequester = new cote.Requester({
    name: 'cms_company_info requester',
    key: 'cms_company_info',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = cmsCompanyInfoRequester;
