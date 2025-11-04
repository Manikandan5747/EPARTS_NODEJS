const cote = require('cote');

// const usersRequester = new cote.Requester({
//   name: 'users requester',
//   key: 'users'
// });

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '10.33.30.5';

const usersRequester = new cote.Requester({
  name: 'users requester',
  key: 'users',
  redis: {
    host: redisHost,
    port: 6379
  }
});

module.exports = usersRequester;
