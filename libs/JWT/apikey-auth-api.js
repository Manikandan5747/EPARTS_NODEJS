require('module-alias/register');
const AppError = require('@libs/error-handler/app-error');
const { getAllSettingsCategory } = require('@libs/common/common-util');

let apiKeyValue = null;

async function loadApiKey() {
  if (apiKeyValue) return apiKeyValue;

  const arr = await getAllSettingsCategory('APIS');
  const apiKey = arr?.find(ele => ele.setparameter === "API_KEY");
  apiKeyValue = apiKey?.setparametervalue || null;

  return apiKeyValue;
}

module.exports = async function checkApiKey(req, res, next) {
  try {
    const storedKey = await loadApiKey();

    const clientToken =
      req.headers['apikey'] ||
      req.headers['x-apikey'];

    if (!storedKey || !clientToken || clientToken !== storedKey) {
      const err = new AppError('API Key authentication failed', 401, ['apikey']);
      err.name = 'ApiKeyError';
      return next(err);
    }

    next();
  } catch (error) {
   console.error("API KEY Load Failed:", err);
  }
};