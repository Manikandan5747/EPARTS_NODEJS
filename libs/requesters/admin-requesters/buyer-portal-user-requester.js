const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const buyerportaluserRequester = new cote.Requester({
  name: 'buyer-portal-user requester',
  key: 'buyer-portal-user',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = buyerportaluserRequester;
