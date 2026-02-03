const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const brandRequester = new cote.Requester({
    name: 'brand requester',
    key: 'brand',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = brandRequester;
