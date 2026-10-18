import crypto from 'crypto';
import User from '../models/User.js';
import { buildCvSource } from '../services/cvSourceService.js';
import { llmAvailable, requestCvAssist, deleteUserLlmData } from '../services/aiLlmClient.js';
import { AI_CONSENT_PROVIDER, AI_CONSENT_TEXT, AI_CONSENT_VERSION } from '../constants/aiConsent.js';
import { logError } from '../services/errorLogger.js';
import { handleServerError } from '../utils/serverError.js';

// ─── LLM features (12) ───────────────────────────────────────────────────────
// GET    /api/ai/status        { available } — AI assistance switched on in AIServices
// GET    /api/ai/consent       the user's consent state + the exact consent text
// POST   /api/ai/consent       { agree: true, version } — give consent (current version only)
// DELETE /api/ai/consent       withdraw; the user's cached AI outputs are deleted in AIServices
// POST   /api/ai/cv-assist     { target, mode, entry?, currentText } — CV assist suggestion + flags
//
// The user id comes only from the verified JWT. CV assist requires current consent; Core builds the
// profile facts on the server (buildCvSource) and sends only what the target needs — never name,
// e-mail, phone, address, links or photo (the name goes only as `redact`, for AIServices to scrub
// from free text before anything reaches the model). Logs: a user hash, target, status, time — no content.

const TARGETS = ['summary', 'experience', 'project'];
const MODES = ['generate', 'improve'];
const PASS_THROUGH = new Set(['LLM_DISABLED', 'LLM_UNAVAILABLE', 'LLM_TIMEOUT', 'LLM_RATE_LIMITED',
  'LLM_QUOTA_EXCEEDED', 'LLM_INVALID_OUTPUT']);
const UNAVAILABLE = { success: false, code: 'LLM_UNAVAILABLE', message: 'AI assistance is temporarily unavailable. Please try again later.' };

const userRef = (id) => crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 12);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const hasConsent = (user) => Boolean(user?.aiConsent?.granted && user.aiConsent.version === AI_CONSENT_VERSION);

export const consentView = (user) => ({
  granted: hasConsent(user),
  version: user?.aiConsent?.version || null,
  currentVersion: AI_CONSENT_VERSION,
  provider: AI_CONSENT_PROVIDER,
  text: AI_CONSENT_TEXT,
  grantedAt: user?.aiConsent?.grantedAt || null,
  withdrawnAt: user?.aiConsent?.withdrawnAt || null,
});

// Every handler answers a clean 500 (logged) on an unexpected error.
const guarded = (message, handler) => async (req, res) => {
  try {
    return await handler(req, res);
  } catch (error) {
    return handleServerError(res, req, error, { module: 'ai', message });
  }
};

export const getStatus = guarded('Failed to check AI availability', async (req, res) =>
  res.json({ success: true, data: { available: await llmAvailable(req) } }));

export const getConsent = guarded('Failed to load your AI consent', async (req, res) => {
  const user = await User.findById(req.user.userId).select('aiConsent').lean();
  return res.json({ success: true, data: consentView(user) });
});

export const giveConsent = guarded('Failed to save your AI consent', async (req, res) => {
  if (req.body?.agree !== true) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Consent must be given explicitly.' });
  }
  if (req.body?.version !== AI_CONSENT_VERSION) {
    return res.status(409).json({ success: false, code: 'CONSENT_VERSION_CHANGED', message: 'The consent text has changed. Please read it again.',
      data: consentView(null) });
  }
  const user = await User.findByIdAndUpdate(req.user.userId, { $set: {
    aiConsent: { granted: true, version: AI_CONSENT_VERSION, provider: AI_CONSENT_PROVIDER, grantedAt: new Date(), withdrawnAt: null },
  } }, { new: true }).select('aiConsent').lean();
  return res.json({ success: true, data: consentView(user) });
});

export const withdrawConsent = guarded('Failed to withdraw your AI consent', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user.userId, { $set: {
    'aiConsent.granted': false, 'aiConsent.withdrawnAt': new Date(),
  } }, { new: true }).select('aiConsent').lean();
  deleteUserLlmData(req.user.userId); // background, retried; the cache also expires on its own
  return res.json({ success: true, data: { ...consentView(user), cachedOutputsDeletion: 'requested' } });
});

// Education status from the stored dates (truthfulness: an unfinished degree must not read as completed).
//   completed    the end date is in the past
//   in_progress  the end date is in the future, or says present / current / expected  (expected_year when known)
//   unknown      no end date
export const educationStatus = (entry, now = new Date()) => {
  const end = str(entry?.endDate, 40).toLowerCase();
  const year = (end.match(/(19|20)\d{2}/) || [])[0] || '';
  if (/present|current|ongoing|expected|now/.test(end)) return { status: 'in_progress', expected_year: year };
  if (!year) return { status: 'unknown', expected_year: '' };
  const month = Number((end.match(/^\d{4}-(\d{2})/) || [])[1] || 12);
  const endsAt = new Date(Number(year), month - 1, 28);
  return endsAt > now ? { status: 'in_progress', expected_year: year } : { status: 'completed', expected_year: '' };
};

// Only the facts the target needs, from the stored profile (server side).
const profileContext = (data) => ({
  headline: str(data.personal?.headline, 200),
  skills: (data.skills || []).flatMap((g) => g.items || []).map((s) => str(s, 100)).filter(Boolean).slice(0, 200),
  experience: (data.experience || []).slice(0, 30).map((e) => ({ title: str(e.title, 200), company: str(e.company, 200),
    startDate: str(e.startDate, 40), endDate: str(e.endDate, 40), current: Boolean(e.current),
    status: e.current ? 'current' : 'past' })),
  education: (data.education || []).slice(0, 20).map((e) => ({ degree: str(e.degree, 200), field: str(e.field, 200),
    institution: str(e.institution, 200), ...educationStatus(e) })),
  projects: (data.projects || []).slice(0, 40).map((p) => ({ name: str(p.name, 200),
    technologies: (p.technologies || []).map((t) => str(t, 100)).filter(Boolean).slice(0, 40) })),
  certifications: (data.certifications || []).slice(0, 40).map((c) => ({ name: str(c.name, 200), issuer: str(c.issuer, 200) })),
});

// The entry being written: allowed fields only (anything else the browser sends is dropped).
const targetEntry = (target, entry = {}) => {
  if (target === 'experience') {
    return { title: str(entry.title, 200), company: str(entry.company, 200), startDate: str(entry.startDate, 40),
      endDate: str(entry.endDate, 40), current: Boolean(entry.current), status: entry.current ? 'current' : 'past' };
  }
  if (target === 'project') {
    const tech = Array.isArray(entry.technologies) ? entry.technologies : [];
    return { name: str(entry.name, 200), technologies: tech.map((t) => str(t, 100)).filter(Boolean).slice(0, 40) };
  }
  return undefined;
};

const nameTerms = (name) => {
  const full = str(name, 100);
  return [full, ...full.split(/\s+/)].filter((t) => t.length >= 2).slice(0, 8);
};

export const cvAssist = guarded('AI assistance failed', async (req, res) => {
  const { target, mode, entry, currentText } = req.body || {};
  if (!TARGETS.includes(target) || !MODES.includes(mode)) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Unknown CV section or action.' });
  }
  if (currentText !== undefined && typeof currentText !== 'string') {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'The current text must be text.' });
  }
  const user = await User.findById(req.user.userId).select('name aiConsent').lean();
  if (!hasConsent(user)) {
    return res.status(403).json({ success: false, code: 'AI_CONSENT_REQUIRED',
      message: 'Please agree to the AI processing notice to use AI assistance.', data: consentView(user) });
  }
  const started = Date.now();
  const ref = userRef(req.user.userId);
  try {
    const { data } = await buildCvSource(req.user.userId);
    const body = {
      target, mode,
      ...(target === 'summary' ? {} : { entry: targetEntry(target, entry) }),
      current_text: str(currentText, 4000),
      context: profileContext(data),
      redact: nameTerms(user?.name),
    };
    const ai = await requestCvAssist(req.user.userId, body, req);
    const ms = Date.now() - started;
    if (ai.status === 200 && ai.data?.success) {
      console.info(`[CvAssist] user=${ref} target=${target} mode=${mode} status=200 flags=${ai.data.data.flags.length} `
        + `cached=${ai.data.data.usage?.cached} ms=${ms}`);
      return res.json({ success: true, data: { suggestion: ai.data.data.suggestion, insufficientData: ai.data.data.insufficient_data,
        flags: ai.data.data.flags } });
    }
    const code = ai.data?.code;
    console.info(`[CvAssist] user=${ref} target=${target} mode=${mode} status=${ai.status} code=${code || '-'} ms=${ms}`);
    if (PASS_THROUGH.has(code)) {
      if (ai.retryAfter) res.set('Retry-After', String(ai.retryAfter));
      return res.status(ai.status).json({ success: false, code, message: ai.data.message,
        ...(ai.data.retry_after_seconds ? { retryAfterSeconds: ai.data.retry_after_seconds } : {}) });
    }
    return res.status(503).json(UNAVAILABLE);
  } catch (error) {
    console.info(`[CvAssist] user=${ref} target=${target} mode=${mode} status=503 ms=${Date.now() - started}`);
    await logError({ level: 'warning', module: 'internal-client', errorType: 'AI_UNAVAILABLE',
      message: `AIServices CV assist failed: ${error.code || 'request error'}`, req });
    return res.status(503).json(UNAVAILABLE);
  }
});
