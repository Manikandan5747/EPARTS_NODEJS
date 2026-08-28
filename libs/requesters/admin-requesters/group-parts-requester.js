const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const groupPartsRequester = new cote.Requester({
  name: 'group_parts requester',
  key: 'group_parts',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = groupPartsRequester;
