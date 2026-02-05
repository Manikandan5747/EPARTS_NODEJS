class AppError extends Error {
  constructor(msg, statusCode, fields) {
    super(msg);
    this.header_type = "ERROR",
      this.message_visibility = true,
      this.statusCode = statusCode;
      this.status = false;
      this.code = 2004,
      this.fields = fields;
     

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);

  }
}

module.exports = AppError;
