const AppError = require('@libs/error-handler/app-error');
require('dotenv').config();

const apiKey = process.env.API_KEY || 'a4db08b7-5729-4ba9-8c08-f2df493465a1';

module.exports = function checkApiKey(req, res, next) {
    const clientToken =
      req.headers['apikey'] || req.headers['x-apikey'];

    if (!clientToken || clientToken !== apiKey) {
        const err = new AppError('API Key authentication failed', 401, ['apikey']);
        err.name = 'ApiKeyError';     // <-- ADDED for your error-handler
        return next(err);
    }

    next();
};
