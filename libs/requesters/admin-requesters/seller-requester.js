const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const sellerRequester = new cote.Requester({
  name: 'seller requester',
  key: 'seller',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = sellerRequester;
