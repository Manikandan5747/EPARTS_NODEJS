const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const role_data_accessRequester = new cote.Requester({
    name: 'role_data_access requester',
    key: 'role_data_access',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = role_data_accessRequester;
