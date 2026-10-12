import { pathOf } from '../config.js';

// Final Express error handler for the gateway: reports the error to Core's
// error log (via the reporter) and answers a clean JSON 500 with a reference.
export const createErrorHandler = (reporter) =>
  // eslint-disable-next-line no-unused-vars
  (err, req, res, next) => {
    reporter.report({
      level: 'error',
      module: 'gateway',
      errorType: err?.name || 'Error',
      message: err?.message || 'Unhandled gateway error',
      stack: err?.stack,
      requestId: req.requestId,
      method: req.method,
      path: pathOf(req),
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
