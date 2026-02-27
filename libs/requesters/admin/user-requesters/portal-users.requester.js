const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const portalusersRequester = new cote.Requester({
  name: 'portalusers requester',
  key: 'portalusers',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = portalusersRequester;
