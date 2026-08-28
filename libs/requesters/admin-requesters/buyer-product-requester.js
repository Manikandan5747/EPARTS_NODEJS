const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const buyerProductRequester = new cote.Requester({
  name: 'buyer-product requester',
  key: 'buyer-product',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = buyerProductRequester;
