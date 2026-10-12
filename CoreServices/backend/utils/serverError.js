import { logError, isDbConnectionError } from '../services/errorLogger.js';
import {
  isMongooseInputError,
  mongooseErrorsToFields,
  validationErrorBody,
} from '../validation/formatErrors.js';

// Mongoose CastError / ValidationError mean bad client input slipped past the
// request schemas: answer 400 VALIDATION_ERROR (never 500). Logged as a
// 'warning' — not 'error' — because the server is fine; but logged at all,
// because each one points at a gap in the schemas worth closing. The message
// lists paths only: Mongoose messages contain the submitted values.
export const handleMongooseInputError = (res, req, err, module = 'unknown') => {
  const errors = mongooseErrorsToFields(err);
  logError({
    level: 'warning',
    module,
    err,
    errorType: `MONGOOSE_${err.name === 'CastError' ? 'CAST' : 'VALIDATION'}_ERROR`,
    message: `${err.name} on ${errors.map((e) => e.field).join(', ') || 'unknown path'}`,
    req,
    statusCode: 400,
  });
  if (res.headersSent) return undefined;
  return res.status(400).json(validationErrorBody(errors));
};

// Shared 500 path for route handlers: log the error (masked, with request
// context) and answer with the API's error shape plus a reference request ID.
// Never sends internal error messages or stack traces to the client.
export const handleServerError = (res, req, err, { module = 'unknown', message = 'Something went wrong' } = {}) => {
  if (isMongooseInputError(err)) return handleMongooseInputError(res, req, err, module);
  logError({ level: isDbConnectionError(err) ? 'critical' : 'error', module, err, req, statusCode: 500 });
  if (res.headersSent) return undefined;
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message,
    requestId: req?.requestId,
  });
};
