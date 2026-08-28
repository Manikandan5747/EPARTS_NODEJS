const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const buyerRequester = new cote.Requester({
  name: 'buyer requester',
  key: 'buyer',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = buyerRequester;
