import axios from 'axios';
import { logError } from './errorLogger.js';

// LLM features (12): CoreServices → AIServices /internal/llm/*. Core never talks to the LLM provider
// and never holds its key. The user travels as X-User-Id (from the verified JWT) with X-Internal-Key.

const client = axios.create();
const baseURL = () => process.env.AI_SERVICE_URL || 'http://localhost:8000';
// One assist call may wait for the provider (15 s per attempt) plus retries.
const ASSIST_TIMEOUT_MS = () => Number(process.env.LLM_ASSIST_TIMEOUT_MS) || 45000;
const headers = (userId, req) => ({
  'X-Internal-Key': process.env.INTERNAL_API_KEY || '',
  ...(userId ? { 'X-User-Id': String(userId) } : {}),
  ...(req?.requestId ? { 'X-Request-Id': req.requestId } : {}),
});

// → { status, data } (AI's answer, any status) — throws only when AI is unreachable / too slow.
export const requestCvAssist = async (userId, body, req) => {
  const res = await client.post(`${baseURL()}/internal/llm/cv-assist`, body, {
    headers: headers(userId, req),
    timeout: ASSIST_TIMEOUT_MS(),
    validateStatus: () => true,
  });
  return { status: res.status, data: res.data, retryAfter: res.headers['retry-after'] };
};

// Whether AI assistance is switched on in AIServices (enabled + key). Never exposes details.
export const llmAvailable = async (req) => {
  try {
    const res = await client.get(`${baseURL()}/internal/llm/status`, { headers: headers(null, req), timeout: 4000 });
    return Boolean(res.data?.data?.enabled);
  } catch {
    return false;
  }
};

// Consent withdrawn / account deleted: delete the user's cached AI outputs in AIServices. Runs in the
// background with retries; the cache also expires on its own (7 days). A final failure is logged.
const retryDelays = () => (process.env.LLM_DELETE_RETRY_DELAYS_MS || '0,1000,4000').split(',').map((n) => Number(n) || 0);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pending = new Set();

export const deleteUserLlmData = (userId) => {
  const job = (async () => {
    let lastError;
    for (const delay of retryDelays()) {
      if (delay) await sleep(delay);
      try {
        await client.delete(`${baseURL()}/internal/llm/user-data`, { headers: headers(userId), timeout: 5000 });
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    await logError({ level: 'warning', module: 'internal-client', errorType: 'LLM_USER_DATA_DELETE_FAILED',
      message: `Could not delete cached AI outputs in AIServices: ${lastError?.code || lastError?.message || 'error'}` });
    return false;
  })();
  pending.add(job);
  job.finally(() => pending.delete(job));
  return job;
};

// Tests: wait for background deletions.
export const flushLlmDeletes = () => Promise.all([...pending]);
