const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const mobileSectionCmsRequester = new cote.Requester({
    name: 'mobile_section_cms requester',
    key: 'mobile_section_cms',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = mobileSectionCmsRequester;
