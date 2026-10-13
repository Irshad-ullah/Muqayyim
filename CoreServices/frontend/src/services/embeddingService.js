// Skill embeddings (Module 2 FE-4/FE-5) — AIServices via the API Gateway.
import { apiError, apiFetch } from './apiErrors.js';
import { API_BASE_URL } from '../config/api.js';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

const get = async (path, fallback) => {
  const res = await apiFetch(`${API_BASE_URL}/api/embeddings${path}`, { headers: authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(res, body, fallback);
  return body;
};

// { status: 'ready' | 'pending' | 'none', skills_count, model, updated_at }
export const getMyEmbeddings = () => get('/me', 'Could not load your skill embeddings');

// { points: [{ name, x, y, source }], closestPairs: [{ a, b, similarity }] }
// Errors: 400 NOT_ENOUGH_SKILLS, 503 EMBEDDINGS_PENDING / MODEL_LOADING.
export const getMySkillMap = () => get('/me/map', 'Could not load your skill map');

export const embeddingService = { getMyEmbeddings, getMySkillMap };
export default embeddingService;
