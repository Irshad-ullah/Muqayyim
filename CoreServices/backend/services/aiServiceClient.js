import axios from 'axios';
import { logError } from './errorLogger.js';

// Internal client for AIServices. CoreServices never touches AI collections
// directly; it asks AIServices over HTTP and degrades gracefully if it is down.
const client = axios.create({ timeout: 5000 });

const baseURL = () => process.env.AI_SERVICE_URL || 'http://localhost:8000';
const internalHeaders = () => ({ 'X-Internal-Key': process.env.INTERNAL_API_KEY || '' });
const describe = (error) => error.response?.status || error.code || error.message;

const warn = (operation, error, req) =>
  logError({
    level: 'warning',
    module: 'internal-client',
    errorType: error.response ? `AI_HTTP_${error.response.status}` : error.code || 'AI_UNAVAILABLE',
    message: `AIServices ${operation} failed: ${describe(error)}`,
    req,
  });

// Latest parsed CV for a user, shaped as { parsed_data, parsing_status, upload_date },
// or null when there is none or AIServices is unavailable.
export const getLatestParsedCv = async (userId, req) => {
  try {
    const { data } = await client.get(`${baseURL()}/internal/cv/${encodeURIComponent(userId)}/latest`, {
      headers: internalHeaders(),
    });
    return data?.cv || null;
  } catch (error) {
    if (error.response?.status === 404) return null;
    console.warn(`AIServices unavailable for latest CV (user ${userId}): ${describe(error)}`);
    warn('latest-CV lookup', error, req);
    return null;
  }
};

// ── Error-log endpoints (admin log view) ─────────────────────────────────────
// Each returns { ok: true, data } or { ok: false } when AIServices is unreachable.
const logsCall = async (operation, request, req) => {
  try {
    const { data } = await request();
    return { ok: true, data };
  } catch (error) {
    if (error.response?.status === 404) return { ok: true, data: null, notFound: true };
    warn(operation, error, req);
    return { ok: false };
  }
};

export const listAiErrorLogs = (params, req) =>
  logsCall('error-log list', () => client.get(`${baseURL()}/internal/logs/errors`, { params, headers: internalHeaders() }), req);

export const getAiErrorLog = (id, req) =>
  logsCall('error-log detail', () => client.get(`${baseURL()}/internal/logs/errors/${encodeURIComponent(id)}`, { headers: internalHeaders() }), req);

export const acknowledgeAiErrorLog = (id, acknowledgedBy, req) =>
  logsCall(
    'error-log acknowledge',
    () =>
      client.patch(
        `${baseURL()}/internal/logs/errors/${encodeURIComponent(id)}/acknowledge`,
        { acknowledgedBy },
        { headers: internalHeaders() },
      ),
    req,
  );

export const getAiLogSummary = (since, req) =>
  logsCall('error-log summary', () => client.get(`${baseURL()}/internal/logs/summary`, { params: { since }, headers: internalHeaders() }), req);
