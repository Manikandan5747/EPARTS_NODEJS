const { saveErrorLog } = require('./common-util');

module.exports = async (err, req, res, next) => {

    await saveErrorLog(pool, {
        api_name: req.originalUrl, 
        method: req.method,
        payload: req.body,
        message: err.message,
        stack: err.stack,
        error_code: err.code || 2004
    });

    res.status(err.statusCode || 500).json({
        status: "error",
        message: err.message
    });
};
