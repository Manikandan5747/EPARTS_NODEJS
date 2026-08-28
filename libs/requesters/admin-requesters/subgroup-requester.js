const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const subgroupRequester = new cote.Requester({
  name: 'subgroup requester',
  key: 'subgroup',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = subgroupRequester;
