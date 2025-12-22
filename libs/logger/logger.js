const { createLogger, format, transports } = require('winston');
const { combine, timestamp, splat, printf } = format;

// Custom line format
const myFormat = printf(({ timestamp, level, message }) => {
  return `${timestamp} : ${level}: ${message}`;
});

const logger = createLogger({
  format: combine(
    splat(),
    timestamp(),
    myFormat
  ),
  transports: [
    new transports.Console(),

    // ✅ Save log file inside container at /app/logs
    // (Make sure docker-compose maps this directory)
    new transports.File({
      filename: '/app/logs/app.log',
      maxsize: 2000000, // 2MB
      maxFiles: 5       // keep last 5 logs (optional)
    })
  ],
  exitOnError: false
});

module.exports = logger;
