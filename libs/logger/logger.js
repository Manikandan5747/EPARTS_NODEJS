// https://stackoverflow.com/questions/12016474/node-js-logging
// https://www.npmjs.com/package/winston
// const CONFIG = require("../config");
const { createLogger, format, transports } = require('winston');
const { splat, combine, timestamp, prettyPrint, printf } = format;
 
const myFormat = printf(({timestamp, level, message }) => {
  // console.log("message ",message);
  // console.log("meta ",meta);
  return `${timestamp} : ${level}: ${message}`;
});

const prettyJson = format.printf(info => {
  return `${JSON.stringify(timestamp())}: ${info.level}: ${info.message}`
})

var logger = createLogger({
    format: combine(
        // format.colorize(),
    // format.prettyPrint(),
    format.splat(),
    format.timestamp(),
    format.simple(),
    myFormat,
        // prettyJson
      ),
  transports: [
    new transports.Console(),
    new transports.File({ filename:'./'+"log", maxsize:2000000}) //MaxSize - 2000000bytes(2MB)
  ],
//   exceptionHandlers: [
//     new (winston.transports.Console)({ json: false, timestamp: true }),
//     new winston.transports.File({ filename: __dirname + '/exceptions.log', json: false })
//   ],
  exitOnError: false
});

module.exports = logger;