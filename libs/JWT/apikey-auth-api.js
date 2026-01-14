const AppError = require('@libs/error-handler/app-error');
require('dotenv').config();
const { getAllSettingsCategory } = require('@libs/common/common-util');

let apiKeyValue = null;

// Load API KEY once
(async () => {
  try {
    const arr = await getAllSettingsCategory('APIS');
    console.log("arr",arr);
    
    const apiKey = arr?.find(ele => ele.setparameter === "API_KEY");
    apiKeyValue = apiKey?.setparametervalue || null;
  } catch (err) {
    console.error("API KEY Load Failed:", err);
  }
})();

module.exports = function checkApiKey(req, res, next) {
  const clientToken =
    req.headers['apikey'] ||
    req.headers['x-apikey'];

  if (!apiKeyValue || !clientToken || clientToken !== apiKeyValue) {
    const err = new AppError('API Key authentication failed', 401, ['apikey']);
    err.name = 'ApiKeyError';
    return next(err);
  }

  next();
};
