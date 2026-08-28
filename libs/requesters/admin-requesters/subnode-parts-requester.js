const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const subnodePartsRequester = new cote.Requester({
  name: 'subnode_parts requester',
  key: 'subnode_parts',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = subnodePartsRequester;
