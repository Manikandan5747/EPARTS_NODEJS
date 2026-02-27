const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const settingsRequester = new cote.Requester({
  name: 'settings requester',
  key: 'settings',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = settingsRequester;
