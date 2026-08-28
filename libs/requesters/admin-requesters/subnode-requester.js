const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const subnodeRequester = new cote.Requester({
  name: 'subnode requester',
  key: 'subnode',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = subnodeRequester;
