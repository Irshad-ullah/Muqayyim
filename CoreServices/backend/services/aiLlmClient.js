import axios from 'axios';
import { logError } from './errorLogger.js';
import PendingLlmDeletion from '../models/PendingLlmDeletion.js';

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

// Consent withdrawn / account deleted: delete the user's cached AI outputs in AIServices. Best effort:
// runs in the background with retries; a final failure is logged and the user goes on the retry list
// (pending_llm_deletions), which the hourly job retries. The cache also expires on its own (7 days).
const retryDelays = () => (process.env.LLM_DELETE_RETRY_DELAYS_MS || '0,1000,4000').split(',').map((n) => Number(n) || 0);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pending = new Set();
const errorCode = (error) => String(error?.response?.status || error?.code || error?.message || 'error').slice(0, 100);
const deleteOnce = (userId) => client.delete(`${baseURL()}/internal/llm/user-data`, { headers: headers(userId), timeout: 5000 });
// Entries older than this are dropped: the cache entries have expired by then (LLM_CACHE_TTL_DAYS 7 + a day).
const RETRY_MAX_AGE_MS = () => (Number(process.env.LLM_DELETE_RETRY_MAX_AGE_DAYS) || 8) * 86400000;

const remember = async (userId, error) => {
  try {
    await PendingLlmDeletion.updateOne({ userId: String(userId) },
      { $set: { lastError: errorCode(error), lastTriedAt: new Date() }, $inc: { attempts: 1 },
        $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  } catch {
    // the retry list is best effort too; the failure is already logged
  }
};

export const deleteUserLlmData = (userId) => {
  const job = (async () => {
    let lastError;
    for (const delay of retryDelays()) {
      if (delay) await sleep(delay);
      try {
        await deleteOnce(userId);
        await PendingLlmDeletion.deleteOne({ userId: String(userId) }).catch(() => {});
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    await logError({ level: 'warning', module: 'internal-client', errorType: 'LLM_USER_DATA_DELETE_FAILED',
      message: `Could not delete cached AI outputs in AIServices: ${errorCode(lastError)} (queued for retry)` });
    await remember(userId, lastError);
    return false;
  })();
  pending.add(job);
  job.finally(() => pending.delete(job));
  return job;
};

// The hourly job: one attempt per queued user; success removes the entry, failure counts the attempt.
// → { retried, deleted, failed, expired }
export const retryPendingLlmDeletes = async (now = new Date()) => {
  const result = { retried: 0, deleted: 0, failed: 0, expired: 0 };
  const expired = await PendingLlmDeletion.deleteMany({ createdAt: { $lt: new Date(now.getTime() - RETRY_MAX_AGE_MS()) } });
  result.expired = expired.deletedCount || 0;
  for (const entry of await PendingLlmDeletion.find({}).sort({ lastTriedAt: 1 }).limit(100).lean()) {
    result.retried += 1;
    try {
      await deleteOnce(entry.userId);
      await PendingLlmDeletion.deleteOne({ _id: entry._id });
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      await PendingLlmDeletion.updateOne({ _id: entry._id },
        { $set: { lastError: errorCode(error), lastTriedAt: now }, $inc: { attempts: 1 } }).catch(() => {});
    }
  }
  if (result.retried || result.expired) {
    console.info(`[LlmDeleteRetry] retried=${result.retried} deleted=${result.deleted} failed=${result.failed} expired=${result.expired}`);
  }
  return result;
};

// Started by server.js (never in tests): retry the list every hour.
export const startLlmDeleteRetryJob = (intervalMs = 3600000) => {
  const run = () => retryPendingLlmDeletes().catch((err) =>
    logError({ level: 'warning', module: 'internal-client', errorType: 'LLM_DELETE_RETRY_JOB_FAILED', err }));
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
};

// Tests: wait for background deletions.
export const flushLlmDeletes = () => Promise.all([...pending]);
