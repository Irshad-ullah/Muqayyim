// Career matching (Module 5) — CoreServices /api/career-matches via the API Gateway.
// The signed-in user's own matches only (the user id comes from the token on the server).
import { apiError, apiFetch } from './apiErrors.js';
import { API_BASE_URL } from '../config/api.js';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

const get = async (path, fallback) => {
  const res = await apiFetch(`${API_BASE_URL}/api/career-matches${path}`, { headers: authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = apiError(res, body, fallback);
    error.retryAfterSeconds = body?.retryAfterSeconds || Number(res.headers.get('Retry-After')) || undefined;
    throw error;
  }
  return body.data;
};

// { state: 'ready' | 'no_skills', results: [...], best_score, low_match, skill_count, computed_at }
// Errors: 503 EMBEDDINGS_PENDING / MODEL_LOADING / INDEX_BUILDING / NO_PROFESSIONS / MATCHING_UNAVAILABLE,
// 504 MATCHING_TIMEOUT.
export const getMatches = () => get('', 'Could not load your career matches');

// { ...summary, rank, of, members: [{ ...breakdown, required, optional, gaps, explanation }] }
// Errors: 404 PROFESSION_NOT_FOUND and the ones above.
export const getMatch = (professionId) =>
  get(`/${encodeURIComponent(professionId)}`, 'Could not load this career');

export const careerMatchService = { getMatches, getMatch };
export default careerMatchService;
