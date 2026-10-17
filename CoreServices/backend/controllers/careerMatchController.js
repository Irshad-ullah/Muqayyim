import crypto from 'crypto';
import axios from 'axios';
import { logError } from '../services/errorLogger.js';
import { relatedCreditEnabled } from '../services/matchingConfig.js';

// ─── Career matching (Module 5, FR7.1–FR7.10) ────────────────────────────────
// GET /api/career-matches               the signed-in user's ranked matches
// GET /api/career-matches/:professionId one match: skill breakdown, explanation, gaps
//
// Identity: the user id comes ONLY from the verified JWT (req.user.userId). There is no user
// id in the URL, query or body, so a user can only ever get their own matches. It reaches AI as
// X-User-Id (with X-Internal-Key), never in a path, so no access log contains it.
// Errors: AI's not-ready codes pass through with their status and Retry-After
// (EMBEDDINGS_PENDING, MODEL_LOADING, INDEX_BUILDING, NO_PROFESSIONS → 503) and 404
// PROFESSION_NOT_FOUND; AI unreachable → 503 MATCHING_UNAVAILABLE; AI too slow → 504
// MATCHING_TIMEOUT. Messages are safe (FR7.10).
// Logs: a hash of the user id, the status, timings and the result count — never skills.
// Scoring mode (Module 5.2): systemconfigs matching.related_credit (default false) goes to AI as X-Related-Credit.

const PREFIX = '/internal/matching/matches';
const aiBase = () => process.env.AI_SERVICE_URL || 'http://localhost:8000';
const timeoutMs = () => Number(process.env.MATCHING_TIMEOUT_MS) || 30000;
const PROFESSION_ID = /^(onet|esco|curated|manual):[A-Za-z0-9._-]{1,100}$/;
const PASS_THROUGH = new Set(['EMBEDDINGS_PENDING', 'MODEL_LOADING', 'INDEX_BUILDING', 'NO_PROFESSIONS',
  'PROFESSION_NOT_FOUND', 'MATCHING_UNAVAILABLE']);

const client = axios.create();

export const MESSAGES = {
  MATCHING_UNAVAILABLE: 'Career matching is temporarily unavailable. Please try again shortly.',
  MATCHING_TIMEOUT: 'Career matching took too long to respond. Please try again.',
  PROFESSION_NOT_FOUND: 'That career was not found.',
};

export const userRef = (userId) => crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 12);

const send = (res, status, body, retryAfter) => {
  if (retryAfter) res.set('Retry-After', String(retryAfter));
  return res.status(status).json(body);
};

const callAi = async (req, res, path, label) => {
  const started = Date.now();
  const ref = userRef(req.user.userId);
  try {
    const relatedCredit = await relatedCreditEnabled();
    const response = await client.get(`${aiBase()}${path}`, {
      timeout: timeoutMs(),
      headers: {
        'X-Internal-Key': process.env.INTERNAL_API_KEY || '',
        'X-User-Id': String(req.user.userId),
        'X-Related-Credit': relatedCredit ? 'true' : 'false',
        ...(req.requestId ? { 'X-Request-Id': req.requestId } : {}),
      },
      validateStatus: () => true,
    });
    const { status, data } = response;
    const ms = Date.now() - started;
    if (status === 200 && data?.success) {
      const count = Array.isArray(data.data?.results) ? data.data.results.length : (data.data?.members?.length ?? 0);
      console.info(`[CareerMatches] ${label} user=${ref} status=200 results=${count} ms=${ms}`);
      return res.status(200).json(data);
    }
    const code = data?.code;
    console.info(`[CareerMatches] ${label} user=${ref} status=${status} code=${code || '-'} ms=${ms}`);
    if (PASS_THROUGH.has(code) && (status === 404 || status === 503)) {
      return send(res, status, { success: false, code, message: data.message, ...(data.retry_after_seconds
        ? { retryAfterSeconds: data.retry_after_seconds } : {}) }, response.headers['retry-after']);
    }
    // Anything else from AI (500, 400 on a bad id from us, …): no internal details to the user.
    return send(res, 503, { success: false, code: 'MATCHING_UNAVAILABLE', message: MESSAGES.MATCHING_UNAVAILABLE });
  } catch (err) {
    const timeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
    console.info(`[CareerMatches] ${label} user=${ref} status=${timeout ? 504 : 503} ms=${Date.now() - started}`);
    await logError({ level: 'warning', module: 'internal-client', errorType: timeout ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
      message: `AIServices career matching ${label} failed: ${err.code || 'request error'}`, req });
    return timeout
      ? send(res, 504, { success: false, code: 'MATCHING_TIMEOUT', message: MESSAGES.MATCHING_TIMEOUT })
      : send(res, 503, { success: false, code: 'MATCHING_UNAVAILABLE', message: MESSAGES.MATCHING_UNAVAILABLE }, 15);
  }
};

export const listMatches = (req, res) => callAi(req, res, PREFIX, 'list');

export const getMatch = (req, res) => {
  const { professionId } = req.params;
  if (!PROFESSION_ID.test(professionId || '')) {
    return res.status(404).json({ success: false, code: 'PROFESSION_NOT_FOUND', message: MESSAGES.PROFESSION_NOT_FOUND });
  }
  return callAi(req, res, `${PREFIX}/${encodeURIComponent(professionId)}`, 'detail');
};
