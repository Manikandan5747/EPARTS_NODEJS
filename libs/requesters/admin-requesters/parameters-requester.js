const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const parametersRequester = new cote.Requester({
  name: 'parameters requester',
  key: 'parameters',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = parametersRequester;
