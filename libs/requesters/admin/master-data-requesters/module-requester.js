const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const moduleRequester = new cote.Requester({
  name: 'module requester',
  key: 'module',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = moduleRequester;
