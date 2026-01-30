const AppError = require('./app-error');
const logger = require('../logger/logger');

/* ---------------------- SPECIFIC ERROR HANDLERS ---------------------- */
const handleCaseError = err =>
  new AppError(`Invalid ${err.path}: ${err.value}.`, 400, []);

const handleTokenExpiryError = () =>
  new AppError('Authorization or session expired, please login again', 401, []);

const handleNoAuthorizationProvidedError = () =>
  new AppError('No Authorization provided', 401, []);

const handleJsonWebTokenError = () =>
  new AppError('Invalid Token', 401, []);

const handleValidationError = err => {
  const errors = Object.values(err.errors).map(el => el.message);
  const fields = Object.values(err.errors).map(el => el.path);
  const message = errors.join(', ');
  return new AppError(message, 400, fields);
};


const handleNoDataAccess = () =>
  new AppError('No data access permission', 403, []);

const handleNoModulePermission = () =>
  new AppError('No module permission for this action', 403, []);

const handleUserNotFound = () =>
  new AppError('User not found', 404, []);

const handleModuleNotRegistered = () =>
  new AppError('Module not registered in system', 403, []);

/* ---------------------- DEV ERROR RESPONSE ---------------------- */
const sendErrorDev = (err, res) => {
  logger.error("Dev error:", err);
  res.status(err.statusCode || 500).json({
    status: err.status,
    message: err.message,
    stack: err.stack,
    fields: err.fields
  });
};

/* ---------------------- PROD ERROR RESPONSE ---------------------- */
const sendErrorProd = (err, res) => {
  logger.error("Prod error:", {
    message: err.message,
    stack: err.stack,
    code: err.code,
  });

  res.status(err.statusCode || 500).json({
    status: err.status,
    message: err.message || 'Unexpected error occurred',
    fields: err.fields || [],
  });
};

/* ========================================================================
      MAIN ERROR HANDLER MIDDLEWARE  (THIS IS WHAT EXPRESS USES)
========================================================================= */
module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  logger.error("Caught Error:", {
    name: err.name,
    message: err.message,
    code: err.code,
  });

  /* ---------------------- HANDLE KNOWN ERROR TYPES ---------------------- */
  if (err.name === 'TokenExpiredError') err = handleTokenExpiryError();
  if (err.name === 'UserLoggedOut') err = handleTokenExpiryError();
  if (err.name === 'NoAuthorizationProvided') err = handleNoAuthorizationProvidedError();
  if (err.name === 'JsonWebTokenError') err = handleJsonWebTokenError();
  if (err.name === 'ValidationError') err = handleValidationError(err);
  if (err.name === 'CastError') err = handleCaseError(err);
  if (err.name === 'NoDataAccess') err = handleNoDataAccess();
  if (err.name === 'NoModulePermission') err = handleNoModulePermission();
  if (err.name === 'UserNotFound') err = handleUserNotFound();
  if (err.name === 'ModuleNotRegistered') err = handleModuleNotRegistered();

  /* ---------------------- MONGO DB DUPLICATE KEY ERROR ------------------ */
  if (err.code && err.code === 11000) {
    const field = Object.keys(err.keyValue);
    const message = `An account with that ${field} already exists.`;
    return res.status(409).json({ status: 'error', message });
  }

  /* ---------------------- CUSTOM API KEY ERROR SUPPORT ------------------ */
  if (err.name === 'ApiKeyError') {
    return res.status(401).json({
      status: 'error', code: 2005,
      message: err.message,
      fields: err.fields || ['apikey']
    });
  }

  /* ---------------------- SEND RESPONSE BASED ON MODE ------------------- */
  if (process.env.NODE_ENV === 'development') {
    return sendErrorDev(err, res);
  }

  try {
    return sendErrorProd(err, res);
  } catch (e) {
    logger.error("Error while handling error:", e);
    return res.status(500).json({
      status: 'error',
      message: 'Something went wrong internally',
    });
  }
};

