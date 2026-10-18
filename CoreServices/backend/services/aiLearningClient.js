import axios from 'axios';

// Module 6: CoreServices → AIServices for learning paths. The user travels as X-User-Id (from the verified JWT) with
// X-Internal-Key. Every call returns { status, data } (AI's answer, any status) and throws only when AI is unreachable.

const client = axios.create();
const baseURL = () => process.env.AI_SERVICE_URL || 'http://localhost:8000';
const headers = (userId, req) => ({
  'X-Internal-Key': process.env.INTERNAL_API_KEY || '',
  'X-User-Id': String(userId),
  ...(req?.requestId ? { 'X-Request-Id': req.requestId } : {}),
});
const post = async (path, userId, body, req, timeout) => {
  const res = await client.post(`${baseURL()}${path}`, body, { headers: headers(userId, req), timeout, validateStatus: () => true });
  return { status: res.status, data: res.data, retryAfter: res.headers['retry-after'] };
};
const get = async (path, userId, req, timeout) => {
  const res = await client.get(`${baseURL()}${path}`, { headers: headers(userId, req), timeout, validateStatus: () => true });
  return { status: res.status, data: res.data };
};

const STRUCTURE_TIMEOUT = () => Number(process.env.LEARNING_STRUCTURE_TIMEOUT_MS) || 30000;
const ENRICH_TIMEOUT = () => Number(process.env.LEARNING_ENRICH_TIMEOUT_MS) || 60000;

export const requestStructure = (userId, body, req) => post('/internal/learning/structure', userId, body, req, STRUCTURE_TIMEOUT());
export const requestEnrichment = (userId, body, req) => post('/internal/llm/learning-enrich', userId, body, req, ENRICH_TIMEOUT());
export const requestMore = (userId, body, req) => post('/internal/llm/learning-more', userId, body, req, ENRICH_TIMEOUT());
export const requestState = (userId, req) => get('/internal/learning/state', userId, req, 10000);
