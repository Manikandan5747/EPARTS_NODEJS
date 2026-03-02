const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const usersRequester = new cote.Requester({
  name: 'admin-iam-users requester',
  key: 'admin-iam-users',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = usersRequester;
