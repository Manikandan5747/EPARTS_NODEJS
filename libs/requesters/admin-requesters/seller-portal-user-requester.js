const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const sellerportaluserRequester = new cote.Requester({
  name: 'seller-portal-user requester',
  key: 'seller-portal-user',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = sellerportaluserRequester;
