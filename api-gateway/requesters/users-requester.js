const cote = require('cote');

const usersRequester = new cote.Requester({
  name: 'users requester',
  key: 'users'
});

module.exports = usersRequester;
