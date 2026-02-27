const cote = require('cote');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';

const usertypeRequester = new cote.Requester({
  name: 'usertype requester',
  key: 'usertype',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = usertypeRequester;
