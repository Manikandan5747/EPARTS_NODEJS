const cote = require('cote');

const roleRequester = new cote.Requester({
  name: 'role requester',
  key: 'role'
});

module.exports = roleRequester;
