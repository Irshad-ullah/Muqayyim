import mongoose from 'mongoose';
import ErrorLog, { LOG_LEVELS, LOG_SERVICES } from '../models/ErrorLog.js';
import { maskMessage, maskStack, truncate } from '../utils/mask.js';
import { sendCriticalAlert } from './alertService.js';

// Central error logger. Fire-and-forget: never throws, never awaits the DB on
// the request path. If MongoDB is unavailable the entry goes to the console.

const DB_CONNECTION_ERRORS = new Set([
  'MongoNetworkError',
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
]);

export const isDbConnectionError = (err) => DB_CONNECTION_ERRORS.has(err?.name);

// Explicit type, else a string error code (e.g. 'ECONNREFUSED'), else the class name.
const errorTypeOf = (explicit, err) => {
  if (explicit) return explicit;
  if (typeof err?.code === 'string' && err.code) return err.code;
  return err?.name || 'Error';
};

const pathOf = (req) => (req?.originalUrl || req?.url || '').split('?')[0].slice(0, 300) || undefined;

// Build a clean, masked entry. Only known fields; never bodies or headers.
export const buildEntry = ({
  level = 'error',
  service = 'core',
  module = 'unknown',
  err,
  errorType,
  message,
  stack,
  req,
  requestId,
  userId,
  method,
  path,
  statusCode,
  timestamp,
} = {}) => ({
  timestamp: timestamp ? new Date(timestamp) : new Date(),
  level: LOG_LEVELS.includes(level) ? level : 'error',
  service: LOG_SERVICES.includes(service) ? service : 'core',
  module: truncate(String(module || 'unknown'), 60),
  errorType: truncate(String(errorTypeOf(errorType, err)), 120),
  message: maskMessage(message ?? err?.message ?? ''),
  stack: maskStack(stack ?? err?.stack),
  requestId: (requestId ?? req?.requestId)?.toString().slice(0, 64),
  userId: (userId ?? req?.user?.id)?.toString().slice(0, 64),
  method: (method ?? req?.method)?.toString().slice(0, 10),
  path: path ? String(path).split('?')[0].slice(0, 300) : pathOf(req),
  statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
});

const toConsole = (entry, reason) => {
  const { stack, ...rest } = entry;
  console.error(`[ErrorLog${reason ? `:${reason}` : ''}] ${JSON.stringify(rest)}`);
};

// Persist an already-built entry. Returns a promise (useful in tests) but
// callers on the request path should not await it.
export const writeEntry = async (entry) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      toConsole(entry, 'db-unavailable');
    } else {
      await ErrorLog.create(entry);
    }
  } catch (writeErr) {
    toConsole(entry, `write-failed ${writeErr.name}`);
  }
  if (entry.level === 'critical') {
    sendCriticalAlert(entry).catch(() => {});
  }
  return entry;
};

// Main entry point: logError({ level, module, err, req, ... }).
export const logError = (options) => {
  let entry;
  try {
    entry = buildEntry(options);
  } catch (buildErr) {
    console.error('[ErrorLog] Could not build entry:', buildErr.message);
    return Promise.resolve(null);
  }
  return writeEntry(entry).catch(() => entry);
};
