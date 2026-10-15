import http from 'http';
import https from 'https';
import axios from 'axios';
import AdminLog from '../models/AdminLog.js';
import { logError } from '../../services/errorLogger.js';

// ─── Admin taxonomy (Module 10 FE-4 / FR12.5) ────────────────────────────────
// Admin-only pass-through to AIServices /internal/admin/taxonomy/*.
//
// Identity: the acting admin is req.user.userId from the VERIFIED JWT, sent to AI
// as X-Admin-Id together with X-Internal-Key. Client-supplied identity fields
// (actor, created_by, …) are stripped from JSON bodies; client headers are never
// forwarded — AI gets only Content-Type/Content-Length, X-Request-Id and the
// internal headers (no Authorization, no cookies). A multipart upload is streamed
// unchanged; AI ignores any created_by form field.
//
// Errors: AI's status and error code are passed through unchanged; AI unreachable
// → 503 TAXONOMY_UNAVAILABLE, AI too slow → 504 TAXONOMY_TIMEOUT.
// Audit: every mutating action writes an AdminLog entry AFTER AI answers, including
// refused and failed attempts (result = status + code). A failure to write the log
// never changes the response; it is logged as an error.

const PREFIX = '/internal/admin/taxonomy';
const aiBase = () => process.env.AI_SERVICE_URL || 'http://localhost:8000';
const JSON_TIMEOUT_MS = Number(process.env.TAXONOMY_TIMEOUT_MS) || 30000;
const UPLOAD_TIMEOUT_MS = Number(process.env.TAXONOMY_UPLOAD_TIMEOUT_MS) || 5 * 60 * 1000;
const MAX_AI_RESPONSE_BYTES = 2 * 1024 * 1024;
const IDENTITY_FIELDS = ['actor', 'created_by', 'createdBy', 'admin_id', 'adminId', 'published_by', 'updated_by'];

const client = axios.create();
const enc = encodeURIComponent;

const aiHeaders = (req) => ({
  'X-Internal-Key': process.env.INTERNAL_API_KEY || '',
  'X-Admin-Id': String(req.user.userId),
  ...(req.requestId ? { 'X-Request-Id': req.requestId } : {}),
});

export const stripIdentity = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out = { ...body };
  for (const field of IDENTITY_FIELDS) delete out[field];
  return out;
};

const unavailable = { success: false, code: 'TAXONOMY_UNAVAILABLE', message: 'The taxonomy service is temporarily unavailable. Please try again shortly.' };
const timedOut = { success: false, code: 'TAXONOMY_TIMEOUT', message: 'The taxonomy service did not answer in time.' };

// ── audit ─────────────────────────────────────────────────────────────────────
export const writeTaxonomyLog = async (req, action, { status, body, resourceId, details = {} }) => {
  const code = body?.code || (status < 400 ? 'OK' : 'ERROR');
  try {
    await AdminLog.create({
      adminId: req.user.userId,
      action,
      resource: 'Taxonomy',
      resourceId: resourceId ? String(resourceId).slice(0, 200) : null,
      details: { ...details, result: { status, code } },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
      status: status < 400 ? 'success' : 'failure',
    });
  } catch (err) {
    await logError({
      level: 'error',
      module: 'admin',
      errorType: 'ADMIN_LOG_WRITE_FAILED',
      message: `Could not write the AdminLog entry for ${action} (${status} ${code}): ${err.name}`,
      req,
    });
  }
};

// ── JSON routes ───────────────────────────────────────────────────────────────
// spec: { method, path(req) → AI path, action?, resourceId?(req, body), details?(req, body) }
const proxyJson = (spec) => async (req, res) => {
  let status;
  let body;
  try {
    const response = await client.request({
      method: spec.method,
      url: `${aiBase()}${PREFIX}${spec.path(req)}`,
      params: spec.method === 'get' ? req.query : undefined,
      data: spec.method === 'get' ? undefined : stripIdentity(req.body ?? {}),
      headers: aiHeaders(req),
      timeout: JSON_TIMEOUT_MS,
      validateStatus: () => true,
    });
    status = response.status;
    body = response.data;
  } catch (error) {
    const timeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
    status = timeout ? 504 : 503;
    body = timeout ? timedOut : unavailable;
    await logError({ level: 'warning', module: 'internal-client', errorType: timeout ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
      message: `AIServices taxonomy ${spec.method.toUpperCase()} ${spec.path(req)} failed: ${error.code || error.message}`, req });
  }
  if (spec.action) {
    await writeTaxonomyLog(req, spec.action, {
      status,
      body,
      resourceId: spec.resourceId ? spec.resourceId(req, body) : null,
      details: spec.details ? spec.details(req, body) : {},
    });
  }
  return res.status(status).json(body);
};

const fieldsOf = (req) => ({ fields: Object.keys(stripIdentity(req.body ?? {})) });

export const listJobs = proxyJson({ method: 'get', path: () => '/jobs' });
export const getJob = proxyJson({ method: 'get', path: (req) => `/jobs/${enc(req.params.id)}` });
export const getJobDiff = proxyJson({ method: 'get', path: (req) => `/jobs/${enc(req.params.id)}/diff` });
export const getSources = proxyJson({ method: 'get', path: () => '/sources' });
export const getLock = proxyJson({ method: 'get', path: () => '/lock' });
export const listSnapshots = proxyJson({ method: 'get', path: () => '/snapshots' });
export const getSnapshot = proxyJson({ method: 'get', path: (req) => `/snapshots/${enc(req.params.id)}` });
export const listRestores = proxyJson({ method: 'get', path: () => '/restores' });
export const getRestore = proxyJson({ method: 'get', path: (req) => `/restores/${enc(req.params.id)}` });
export const listProfessions = proxyJson({ method: 'get', path: () => '/professions' });
export const getProfession = proxyJson({ method: 'get', path: (req) => `/professions/${enc(req.params.id)}` });
export const listSkills = proxyJson({ method: 'get', path: () => '/skills' });
export const getSkill = proxyJson({ method: 'get', path: (req) => `/skills/${enc(req.params.name)}` });

export const previewJob = proxyJson({
  method: 'post', path: (req) => `/jobs/${enc(req.params.id)}/preview`,
  action: 'TAXONOMY_PREVIEW', resourceId: (req) => req.params.id,
});
export const publishJob = proxyJson({
  method: 'post', path: (req) => `/jobs/${enc(req.params.id)}/publish`,
  action: 'TAXONOMY_PUBLISH', resourceId: (req) => req.params.id,
  details: (req) => ({ acknowledgeBackgroundWarning: req.body?.acknowledge_background_warning === true }),
});
export const cancelJob = proxyJson({
  method: 'post', path: (req) => `/jobs/${enc(req.params.id)}/cancel`,
  action: 'TAXONOMY_CANCEL', resourceId: (req) => req.params.id,
});
export const restoreSnapshot = proxyJson({
  method: 'post', path: (req) => `/snapshots/${enc(req.params.id)}/restore`,
  action: 'TAXONOMY_RESTORE', resourceId: (req) => req.params.id,
  details: (req, body) => ({ restoreId: body?.data?.restore_id ?? null }),
});
export const editProfession = proxyJson({
  method: 'patch', path: (req) => `/professions/${enc(req.params.id)}`,
  action: 'TAXONOMY_EDIT', resourceId: (req) => req.params.id,
  details: (req, body) => ({ target: 'profession', ...fieldsOf(req), snapshotId: body?.data?.snapshot_id ?? null }),
});
export const resetProfession = proxyJson({
  method: 'post', path: (req) => `/professions/${enc(req.params.id)}/reset`,
  action: 'TAXONOMY_EDIT', resourceId: (req) => req.params.id,
  details: (req, body) => ({ target: 'profession', operation: 'reset', fields: req.body?.fields ?? 'all',
    snapshotId: body?.data?.snapshot_id ?? null }),
});
export const validateSkill = proxyJson({
  method: 'post', path: () => '/skills/validate',
  action: 'TAXONOMY_VALIDATE', resourceId: (req) => req.body?.name,
  details: (req, body) => ({ target: 'skill', valid: body?.data?.valid ?? null }),
});
export const createSkill = proxyJson({
  method: 'post', path: () => '/skills',
  action: 'TAXONOMY_EDIT', resourceId: (req) => req.body?.name,
  details: (req, body) => ({ target: 'skill', operation: 'create', ...fieldsOf(req), snapshotId: body?.data?.snapshot_id ?? null }),
});
export const updateSkill = proxyJson({
  method: 'put', path: (req) => `/skills/${enc(req.params.name)}`,
  action: 'TAXONOMY_EDIT', resourceId: (req) => req.params.name,
  details: (req, body) => ({ target: 'skill', ...fieldsOf(req), snapshotId: body?.data?.snapshot_id ?? null }),
});

// ── upload (streamed) ─────────────────────────────────────────────────────────
// Runs only after adminAuthMiddleware: a non-admin is refused before a single byte
// of the body is read or anything is sent to AI. The multipart body is piped to AI
// as it arrives (never buffered whole). If the client aborts, the AI request is
// destroyed: AI never completes the form, so no job is created.
const uploadSummary = (body) => {
  const job = body?.data;
  if (!job) return { jobId: body?.job_id ?? null };
  const files = job.file_summary || {};
  return { jobId: job.job_id, source: job.source, datasetVersion: job.dataset_version, jobStatus: job.status,
    mode: files.mode ?? null, uploadBytes: files.upload_bytes ?? null, ignoredFiles: files.ignored_count ?? null };
};

export const uploadTaxonomy = (req, res) => {
  const length = req.headers['content-length'];
  const type = req.headers['content-type'] || '';
  const log = (status, body) => writeTaxonomyLog(req, 'TAXONOMY_UPLOAD', {
    status, body, resourceId: body?.data?.job_id ?? body?.job_id ?? null, details: uploadSummary(body) });
  if (!type.toLowerCase().startsWith('multipart/form-data')) {
    const body = { success: false, code: 'UPLOAD_REJECTED', message: 'Send the files as multipart/form-data' };
    req.resume();
    return log(422, body).then(() => res.status(422).json(body));
  }
  if (!length || !/^\d+$/.test(length)) {
    const body = { success: false, code: 'LENGTH_REQUIRED', message: 'Content-Length is required for uploads' };
    req.resume();
    return log(411, body).then(() => res.status(411).json(body));
  }

  const target = new URL(`${aiBase()}${PREFIX}/jobs`);
  const lib = target.protocol === 'https:' ? https : http;
  let finished = false;
  const finish = async (status, body) => {
    if (finished) return;
    finished = true;
    await log(status, body);
    if (!res.headersSent && !res.writableEnded) res.status(status).json(body);
  };

  const aiReq = lib.request({
    method: 'POST',
    hostname: target.hostname,
    port: target.port,
    path: target.pathname,
    headers: { 'Content-Type': type, 'Content-Length': length, ...aiHeaders(req) },
    timeout: UPLOAD_TIMEOUT_MS,
  });

  aiReq.on('response', (aiRes) => {
    const chunks = [];
    let size = 0;
    aiRes.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_AI_RESPONSE_BYTES) chunks.push(chunk);
    });
    aiRes.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = { success: false, code: 'BAD_UPSTREAM_RESPONSE', message: 'The taxonomy service sent an unreadable answer' };
      }
      finish(aiRes.statusCode, body);
    });
  });
  aiReq.on('timeout', () => aiReq.destroy(Object.assign(new Error('upload timed out'), { code: 'ETIMEDOUT' })));
  aiReq.on('error', async (error) => {
    if (finished) return;
    const timeout = error.code === 'ETIMEDOUT';
    await logError({ level: 'warning', module: 'internal-client', errorType: timeout ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
      message: `AIServices taxonomy upload failed: ${error.code || error.message}`, req });
    finish(timeout ? 504 : 503, timeout ? timedOut : unavailable);
  });

  // Client went away before the whole body arrived: stop the AI request (no job is created).
  req.on('close', () => {
    if (!req.complete && !finished) {
      finished = true;
      aiReq.destroy();
      log(499, { success: false, code: 'CLIENT_ABORTED', message: 'The upload was aborted by the client' });
    }
  });
  req.pipe(aiReq);
  return undefined;
};
