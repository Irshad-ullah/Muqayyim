import { buildEntry, writeEntry } from '../services/errorLogger.js';
import { sendCriticalAlert } from '../services/alertService.js';
import { LOG_LEVELS } from '../models/ErrorLog.js';
import { maskMessage } from '../utils/mask.js';

export const MAX_BATCH = 50;

// Only these fields are accepted from other services; everything else
// (bodies, headers, …) is ignored. Values are masked and truncated.
const pickEntry = (e) => ({
  level: e.level,
  module: e.module,
  errorType: e.errorType,
  message: e.message,
  stack: e.stack,
  requestId: e.requestId,
  userId: e.userId,
  method: e.method,
  path: e.path,
  statusCode: Number(e.statusCode) || undefined,
  timestamp: e.timestamp && !Number.isNaN(Date.parse(e.timestamp)) ? e.timestamp : undefined,
});

const validate = (e, i) => {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return `entry ${i}: must be an object`;
  if (!LOG_LEVELS.includes(e.level)) return `entry ${i}: level must be one of ${LOG_LEVELS.join(', ')}`;
  if (typeof e.message !== 'string' || !e.message.trim()) return `entry ${i}: message is required`;
  return null;
};

// @route   POST /internal/logs
// @desc    Store error-log entries reported by the API Gateway (one or up to 50)
// @access  Internal (X-Internal-Key)
export const ingestLogs = async (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : [req.body];
  if (!entries.length) {
    return res.status(400).json({ success: false, code: 'INVALID_LOG', message: 'No log entries provided' });
  }
  if (entries.length > MAX_BATCH) {
    return res.status(400).json({
      success: false,
      code: 'TOO_MANY_ENTRIES',
      message: `At most ${MAX_BATCH} entries per request`,
    });
  }
  const problems = entries.map(validate).filter(Boolean);
  if (problems.length) {
    return res.status(400).json({ success: false, code: 'INVALID_LOG', message: problems[0], errors: problems });
  }

  const built = entries.map((e) => buildEntry({ ...pickEntry(e), service: 'gateway' }));
  await Promise.all(built.map((entry) => writeEntry(entry)));
  return res.status(202).json({ success: true, accepted: built.length });
};

// @route   POST /internal/alerts
// @desc    Critical-error alert from another service (AIServices); Core emails
//          the active admins, throttled per (service, errorType)
// @access  Internal (X-Internal-Key)
export const receiveAlert = async (req, res) => {
  const { service, module, errorType, message, requestId, timestamp } = req.body || {};
  if (!['ai', 'gateway'].includes(service) || !errorType) {
    return res.status(400).json({ success: false, code: 'INVALID_ALERT', message: 'service and errorType are required' });
  }
  const result = await sendCriticalAlert({
    service,
    module: String(module || 'unknown').slice(0, 60),
    errorType: String(errorType).slice(0, 120),
    message: maskMessage(message),
    requestId: requestId ? String(requestId).slice(0, 64) : undefined,
    timestamp: timestamp && !Number.isNaN(Date.parse(timestamp)) ? timestamp : new Date(),
  });
  return res.status(202).json({ success: true, result });
};
