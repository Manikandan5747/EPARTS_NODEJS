const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const statesRequester = new cote.Requester({
    name: 'states requester',
    key: 'states',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = statesRequester;
