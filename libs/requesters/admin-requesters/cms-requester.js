const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const cmsRequester = new cote.Requester({
  name: 'cms requester',
  key: 'cms',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = cmsRequester;
