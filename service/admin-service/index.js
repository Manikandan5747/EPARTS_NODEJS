
console.log("Admin Service Started...");

// Load all responder modules
require('./responder/roles.responder');
require('./responder/user-type.responder');
require('./responder/users.responder');

module.exports = {
  rolesResponder: require('./responder/roles.responder'),
  userTypeResponder: require('./responder/user-type.responder'),
  usersResponder: require('./responder/users.responder')
};














