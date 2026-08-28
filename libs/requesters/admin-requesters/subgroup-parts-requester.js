const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const subgroupPartsRequester = new cote.Requester({
  name: 'subgroup_parts requester',
  key: 'subgroup_parts',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = subgroupPartsRequester;
