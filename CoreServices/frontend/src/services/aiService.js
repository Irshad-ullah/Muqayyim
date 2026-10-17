// LLM features (12) — CoreServices /api/ai via the API Gateway. The browser never talks to the AI
// provider and never sees its key; consent and the facts are handled on the server.
import { apiError, apiFetch } from './apiErrors.js';
import { API_BASE_URL } from '../config/api.js';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' });

const call = async (method, path, body, fallback) => {
  const res = await apiFetch(`${API_BASE_URL}/api/ai${path}`, {
    method, headers: authHeaders(), ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = apiError(res, data, fallback);
    error.retryAfterSeconds = data?.retryAfterSeconds || Number(res.headers.get('Retry-After')) || undefined;
    error.data = data?.data;
    throw error;
  }
  return data.data;
};

export const aiService = {
  // { available }
  getStatus: () => call('GET', '/status', undefined, 'Could not check AI availability'),
  // { granted, version, currentVersion, provider, text, grantedAt, withdrawnAt }
  getConsent: () => call('GET', '/consent', undefined, 'Could not load your AI settings'),
  giveConsent: (version) => call('POST', '/consent', { agree: true, version }, 'Could not save your consent'),
  withdrawConsent: () => call('DELETE', '/consent', undefined, 'Could not withdraw your consent'),
  // { suggestion, insufficientData, flags: [{ text, reason, start, end }] }
  cvAssist: (request) => call('POST', '/cv-assist', request, 'AI assistance failed'),
};

export default aiService;
