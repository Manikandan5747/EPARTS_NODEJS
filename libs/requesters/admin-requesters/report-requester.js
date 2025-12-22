const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const reportsRequester = new cote.Requester({
  name: 'reports requester',
  key: 'reports',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = reportsRequester;
