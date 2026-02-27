const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

module.exports = (key) => {
    return new cote.Requester({
        name: `${key} requester`,
        key,
        redis: {
            host: redisHost,
            port: redisPort
        }
    });
};
