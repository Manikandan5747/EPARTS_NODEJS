const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const currencyRequester = new cote.Requester({
    name: 'currency requester',
    key: 'currency',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = currencyRequester;
