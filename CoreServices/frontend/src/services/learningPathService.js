// Learning paths (Module 6) — CoreServices /api/learning-paths via the API Gateway. The signed-in user's own paths
// only (the user id comes from the token on the server).
import { apiError, apiFetch } from './apiErrors.js';
import { API_BASE_URL } from '../config/api.js';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' });

const call = async (method, path, body, fallback) => {
  const res = await apiFetch(`${API_BASE_URL}/api/learning-paths${path}`, {
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

export const learningPathService = {
  list: () => call('GET', '', undefined, 'Could not load your learning paths'),
  get: (id) => call('GET', `/${encodeURIComponent(id)}`, undefined, 'Could not load the learning path'),
  // { professionId, choices: { requirementKey: alternativeKey }, preferences: { language, cost, hoursPerWeek } }
  create: (request) => call('POST', '', request, 'Could not create the learning path'),
  setStatus: (id, key, status) =>
    call('PATCH', `/${encodeURIComponent(id)}/modules/${encodeURIComponent(key)}`, { status }, 'Could not update the module'),
  remove: (id) => call('DELETE', `/${encodeURIComponent(id)}`, undefined, 'Could not delete the learning path'),
};

export default learningPathService;
