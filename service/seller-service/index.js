

console.log("Admin Service Started...");

// Load all responder modules
require('./responder/users.responder');


module.exports = {
  usersResponder: require('./responder/users.responder'),
};














