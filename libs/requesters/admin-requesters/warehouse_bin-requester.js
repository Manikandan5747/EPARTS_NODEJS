const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const warehouse_binRequester = new cote.Requester({
    name: 'warehouse_bin requester',
    key: 'warehouse_bin',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = warehouse_binRequester;
