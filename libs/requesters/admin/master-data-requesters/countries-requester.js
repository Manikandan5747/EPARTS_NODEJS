const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const countriesRequester = new cote.Requester({
    name: 'countries requester',
    key: 'countries',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = countriesRequester;
