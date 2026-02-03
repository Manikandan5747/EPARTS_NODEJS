const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const cmsHomepageFeaturesRequester = new cote.Requester({
    name: 'cms_homepage_features_section requester',
    key: 'cms_homepage_features_section',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = cmsHomepageFeaturesRequester;
