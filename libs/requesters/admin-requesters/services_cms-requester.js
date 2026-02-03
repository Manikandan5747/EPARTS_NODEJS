const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const servicesCmsRequester = new cote.Requester({
    name: 'services_cms requester',
    key: 'services_cms',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = servicesCmsRequester;
