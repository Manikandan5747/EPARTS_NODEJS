const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const cmsHomepageBannerSectionRequester = new cote.Requester({
    name: 'cms_homepage_banner_section requester',
    key: 'cms_homepage_banner_section',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = cmsHomepageBannerSectionRequester;
