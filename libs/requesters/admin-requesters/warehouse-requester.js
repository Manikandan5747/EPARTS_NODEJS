const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const warehouseRequester = new cote.Requester({
    name: 'warehouse requester',
    key: 'warehouse',
    redis: {
        host: redisHost,
        port: 6379
    }
});

module.exports = warehouseRequester;
