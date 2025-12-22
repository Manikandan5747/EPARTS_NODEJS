class AppError extends Error {
  constructor(msg, statusCode, fields) {
    super(msg);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.fields = fields;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);

    // 🧩 Log details to console
    console.error("🚨 AppError Created:");
    console.error(`   Message     : ${msg}`);
    console.error(`   Status Code : ${statusCode}`);
    console.error(`   Status Type : ${this.status}`);
    if (fields) console.error(`   Fields      : ${JSON.stringify(fields)}`);
    console.error(`   Stack Trace :\n${this.stack}`);
  }
}

module.exports = AppError;
