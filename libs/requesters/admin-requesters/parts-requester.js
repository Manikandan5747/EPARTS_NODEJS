const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const partsRequester = new cote.Requester({
  name: 'parts requester',
  key: 'parts',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = partsRequester;
