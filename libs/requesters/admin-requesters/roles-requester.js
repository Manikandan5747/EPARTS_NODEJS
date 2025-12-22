const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const roleRequester = new cote.Requester({
  name: 'roles requester',
  key: 'roles',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = roleRequester;
