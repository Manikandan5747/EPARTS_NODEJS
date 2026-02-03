const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const cmsSocialMediaInfoRequester = new cote.Requester({
    name: 'cms_social_media_info requester',
    key: 'cms_social_media_info',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = cmsSocialMediaInfoRequester;
