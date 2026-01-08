const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const profileRequester = new cote.Requester({
  name: 'profile_privilege requester',
  key: 'profile_privilege',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = profileRequester;
