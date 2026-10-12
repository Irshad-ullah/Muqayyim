import { logError, isDbConnectionError } from '../services/errorLogger.js';
import { isMongooseInputError } from '../validation/formatErrors.js';
import { handleMongooseInputError } from '../utils/serverError.js';

// Final Express error handler: anything thrown or passed to next(err) that no
// route handled ends up here. Logged, then a clean 500 with a reference ID.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  // Malformed JSON bodies are client errors, not server faults.
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    return res.status(err.status || 400).json({
      success: false,
      code: err.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
      message: err.type === 'entity.too.large' ? 'Request is too large.' : 'Request body is not valid JSON.',
      requestId: req.requestId,
    });
  }

  // Mongoose CastError / ValidationError: client input, 400 (see serverError.js).
  if (isMongooseInputError(err)) return handleMongooseInputError(res, req, err, 'unhandled');

  logError({
    level: isDbConnectionError(err) ? 'critical' : 'error',
    module: 'unhandled',
    err,
    req,
    statusCode: 500,
  });
  if (res.headersSent) return next(err);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: `Something went wrong. Reference: ${req.requestId}`,
    requestId: req.requestId,
  });
};

export default errorHandler;
