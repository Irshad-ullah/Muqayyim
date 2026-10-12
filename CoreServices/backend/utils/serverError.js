import { logError, isDbConnectionError } from '../services/errorLogger.js';

// Shared 500 path for route handlers: log the error (masked, with request
// context) and answer with the API's error shape plus a reference request ID.
// Never sends internal error messages or stack traces to the client.
export const handleServerError = (res, req, err, { module = 'unknown', message = 'Something went wrong' } = {}) => {
  logError({ level: isDbConnectionError(err) ? 'critical' : 'error', module, err, req, statusCode: 500 });
  if (res.headersSent) return undefined;
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message,
    requestId: req?.requestId,
  });
};
