const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const citiesRequester = new cote.Requester({
    name: 'cities requester',
    key: 'cities',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = citiesRequester;
