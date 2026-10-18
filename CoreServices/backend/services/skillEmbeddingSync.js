import crypto from 'crypto';
import axios from 'axios';
import { logError } from './errorLogger.js';

// Skill embeddings (Module 2 FE-5, FR-B9): CoreServices owns profiles,
// AIServices owns the vectors. Whenever a profile write changes the merged
// skill set, the merged skills are pushed to
//   PUT /internal/embeddings/users/:id   { skills: [{ name, source }], requestedAt }
// The push never delays or fails the save: it runs in the background, in order
// per user, with retries; a final failure is a warning in error_logs.
// `source` is for display only; AIServices never uses it in a calculation.

const client = axios.create({ timeout: 5000 });
const baseURL = () => process.env.AI_SERVICE_URL || 'http://localhost:8000';
const headers = () => ({ 'X-Internal-Key': process.env.INTERNAL_API_KEY || '' });

// Delays before each attempt (ms). Override in tests with
// EMBEDDING_SYNC_RETRY_DELAYS_MS="0,10,20".
const retryDelays = () =>
  (process.env.EMBEDDING_SYNC_RETRY_DELAYS_MS || '0,1000,4000')
    .split(',')
    .map((n) => Number(n) || 0);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Profile skill lists in the profile's own dedupe order (the user's spelling wins).
const SOURCES = [
  ['manual', 'manual'],
  ['cv', 'cv'],
  ['extracted', 'github'],
  ['learning', 'learning'], // Module 6: completed learning-path modules (not verified)
];

export const mergedSkills = (profile) => {
  const seen = new Set();
  const out = [];
  for (const [field, source] of SOURCES) {
    for (const raw of profile?.skills?.[field] || []) {
      const name = typeof raw === 'string' ? raw.trim() : '';
      const key = name.toLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        out.push({ name, source });
      }
    }
  }
  return out;
};

// Hash of the merged skill keys (lowercased, trimmed, sorted): equal hashes
// mean the skill set did not change and AIServices is not called.
export const skillsHash = (profile) =>
  crypto
    .createHash('sha256')
    .update(mergedSkills(profile).map((s) => s.name.toLowerCase()).sort().join('\n'))
    .digest('hex');

const warn = (operation, userId, error) =>
  logError({
    level: 'warning',
    module: 'embeddings-sync',
    errorType: error?.response ? `AI_HTTP_${error.response.status}` : error?.code || 'AI_UNAVAILABLE',
    message: `Skill embedding ${operation} for user ${userId} failed after retries: ${
      error?.response?.status || error?.code || error?.message
    }`,
    userId,
  });

// 4xx (except 408/429) will not succeed on retry.
const retryable = (error) => {
  const status = error?.response?.status;
  return !status || status >= 500 || status === 408 || status === 429;
};

const attempt = async (operation, userId, send) => {
  let lastError;
  for (const delay of retryDelays()) {
    if (delay) await sleep(delay);
    try {
      return await send();
    } catch (error) {
      lastError = error;
      if (!retryable(error)) break;
    }
  }
  warn(operation, userId, lastError);
  return null;
};

// One chain per user keeps pushes in order (the latest skill list arrives last).
const chains = new Map();

const enqueue = (userId, operation, send) => {
  const previous = chains.get(userId) || Promise.resolve();
  const next = previous.then(() => attempt(operation, userId, send)).catch(() => null);
  chains.set(userId, next);
  next.finally(() => {
    if (chains.get(userId) === next) chains.delete(userId);
  });
  return next;
};

// Fire-and-forget: callers do not await this.
export const notifySkillsChanged = (userId, profile) => {
  const id = String(userId);
  const body = { skills: mergedSkills(profile), requestedAt: Date.now() };
  return enqueue(id, 'update', () =>
    client.put(`${baseURL()}/internal/embeddings/users/${encodeURIComponent(id)}`, body, { headers: headers() }),
  );
};

export const deleteUserEmbeddings = (userId) => {
  const id = String(userId);
  return enqueue(id, 'delete', () =>
    client.delete(`${baseURL()}/internal/embeddings/users/${encodeURIComponent(id)}`, { headers: headers() }),
  );
};

// Profile write helper: notify only when the merged skill set changed.
export const syncSkillsIfChanged = (userId, before, after) => {
  if (skillsHash(before) === skillsHash(after)) return null;
  return notifySkillsChanged(userId, after);
};

// Tests: wait until queued pushes have finished.
export const flushEmbeddingSync = () => Promise.all([...chains.values()]);
