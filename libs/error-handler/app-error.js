class AppError extends Error {

    constructor(msg, statusCode,fields) {
        super(msg);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.fields = fields;

        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = AppError;
