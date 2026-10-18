import mongoose from 'mongoose';
import LearningPath from '../models/LearningPath.js';
import Profile from '../models/Profile.js';
import User from '../models/User.js';
import { consentView, hasConsent } from './aiController.js';
import { mergedSkills, syncSkillsIfChanged } from '../services/skillEmbeddingSync.js';
import { requestEnrichment, requestMore, requestState, requestStructure } from '../services/aiLearningClient.js';
import { handleServerError } from '../utils/serverError.js';

// ─── Learning paths (Module 6, FR8.1–FR8.9) ──────────────────────────────────
// POST   /api/learning-paths                       { professionId, choices?, preferences? } → the saved path
// GET    /api/learning-paths                       the user's paths (summary + progress)
// GET    /api/learning-paths/:id                   one path
// PATCH  /api/learning-paths/:id/modules/:key      { status } — completing adds the skill to the profile (learning)
// DELETE /api/learning-paths/:id
// GET    /api/learning-paths/:id/freshness             { available, stale, profileChanged, dataChanged } (the "Regenerate?" check)
// POST   /api/learning-paths/:id/regenerate            { preferences? } rebuild; module progress kept by skill
// POST   /api/learning-paths/:id/modules/:key/feedback { title, vote: 'up' | 'down' | null } on one recommendation
// POST   /api/learning-paths/:id/modules/:key/more     "Suggest another resource" (LLM, needs consent)
// POST   /api/learning-paths/:id/enrich                { keys? } "Retry AI details" for modules without them (needs consent)
// AI details per module (aiStatus): modules the LLM answer did not cover validly are retried ONCE automatically in the
// background (not counted against the user's daily AI quota); what still fails gets a "Retry AI details" button.
// The user id comes only from the verified JWT. Creating a path needs the current AI consent (the notice includes
// "your skills and learning preferences, to build learning paths"). The structure is deterministic (AIServices);
// the enrichment is the LLM's — if it is unavailable or rejected, the path is still saved without it.

export const MAX_PATHS = 5;
const PROFESSION_ID = /^(onet|esco|curated|manual):[A-Za-z0-9._-]{1,100}$/;
const PASS_THROUGH = new Set(['PROFESSION_NOT_FOUND', 'INVALID_CHOICE', 'EMBEDDINGS_PENDING', 'MODEL_LOADING',
  'INDEX_BUILDING', 'NO_PROFESSIONS', 'MATCHING_UNAVAILABLE']);
const COSTS = ['free', 'include_paid'];
const STATUSES = ['not_started', 'in_progress', 'completed'];
export const MAX_RECOMMENDATIONS = 10; // per module, after "Suggest another resource"
const VOTES = ['up', 'down'];
// Enrichment failures worth one automatic retry (not: the LLM switched off, or the user's quota used up).
const RETRYABLE = new Set(['LLM_INVALID_OUTPUT', 'LLM_TIMEOUT', 'LLM_UNAVAILABLE', 'LLM_RATE_LIMITED']);

const unavailable = (res) => res.status(503).json({ success: false, code: 'LEARNING_UNAVAILABLE',
  message: 'Learning paths are temporarily unavailable. Please try again shortly.' });

const passThrough = (res, ai) => {
  const code = ai.data?.code;
  if (PASS_THROUGH.has(code) && [404, 422, 503].includes(ai.status)) {
    if (ai.retryAfter) res.set('Retry-After', String(ai.retryAfter));
    return res.status(ai.status).json({ success: false, code, message: ai.data.message });
  }
  return unavailable(res);
};

const validPreferences = (p = {}) => {
  const preferences = {
    cost: p.cost ?? 'free',
    hoursPerWeek: p.hoursPerWeek ?? 5,
  };
  if (!COSTS.includes(preferences.cost)
      || !Number.isInteger(preferences.hoursPerWeek) || preferences.hoursPerWeek < 1 || preferences.hoursPerWeek > 60) {
    return null;
  }
  return preferences;
};

const validChoices = (choices) => {
  if (choices == null) return {};
  if (typeof choices !== 'object' || Array.isArray(choices) || Object.keys(choices).length > 40) return null;
  const out = {};
  for (const [k, v] of Object.entries(choices)) {
    if (typeof k !== 'string' || typeof v !== 'string' || k.length > 120 || v.length > 120) return null;
    out[k] = v;
  }
  return out;
};

const fromStructure = (m) => ({
  key: m.key, skill: m.skill, requirementKey: m.requirement_key, requirement: m.requirement, tier: m.tier,
  order: m.order, quickWin: Boolean(m.quick_win), hint: m.hint || undefined, alternatives: m.alternatives || [],
  prerequisites: m.prerequisites || [],
});

const fromRecommendation = (r) => ({
  platform: r.platform, title: r.title, instructor: r.instructor || '', description: r.description || '', free: r.free,
  searchUrl: r.search_url, searchLabel: r.search_label, label: r.label,
});

const detailsOf = (e) => ({ why: e.why, subtopics: e.subtopics, project: e.project, hours: { min: e.hours.min, max: e.hours.max },
  recommendations: e.recommendations.map(fromRecommendation), aiStatus: 'enriched' });

// The enrichment by module key, and its prerequisite order (validated by AIServices).
export const applyEnrichment = (modules, enrichment) => {
  const byKey = new Map(enrichment.modules.map((m) => [m.key, m]));
  const enriched = modules.map((m) => {
    const e = byKey.get(m.key);
    return e ? { ...m, ...detailsOf(e) } : m;
  });
  const order = enrichment.order || [];
  const prereqs = new Map();
  for (const [before, after] of enrichment.prerequisites?.accepted || []) prereqs.set(after, [...(prereqs.get(after) || []), before]);
  const position = new Map(order.map((k, i) => [k, i]));
  return enriched
    .slice()
    .sort((a, b) => (position.get(a.key) ?? a.order) - (position.get(b.key) ?? b.order))
    .map((m, i) => ({ ...m, order: i + 1, prerequisites: prereqs.get(m.key) || m.prerequisites || [] }));
};

export const progressOf = (path) => {
  const total = path.modules.length;
  const completed = path.modules.filter((m) => m.status === 'completed').length;
  return { total, completed, inProgress: path.modules.filter((m) => m.status === 'in_progress').length,
    percent: total ? Math.round((100 * completed) / total) : 0 };
};

// Paths saved before aiStatus existed: a module with a description is enriched, one without has failed.
const aiStatusOf = (m) => m.aiStatus || (m.why ? 'enriched' : 'failed');

const view = (doc) => {
  const path = doc.toObject ? doc.toObject() : doc;
  const { _id, userId, __v, ...rest } = path;
  const modules = path.modules.map((m) => ({ ...m, aiStatus: aiStatusOf(m) }));
  return { id: String(_id), ...rest, modules, progress: progressOf(path) };
};

const enrichmentRequest = (title, modules, profile, preferences, automatic) => ({
  role_title: title,
  modules: modules.map((m) => ({ key: m.key, skill: m.skill })),
  user_skills: mergedSkills(profile).map((x) => x.name).slice(0, 300),
  preferences: { cost: preferences.cost, hours_per_week: preferences.hoursPerWeek },
  ...(automatic ? { automatic_retry: true } : {}),
});

const totalHoursOf = (modules) => {
  const timed = modules.filter((m) => m.hours?.max);
  return timed.length ? { min: timed.reduce((n, m) => n + m.hours.min, 0), max: timed.reduce((n, m) => n + m.hours.max, 0) } : undefined;
};

// Path-level status from its modules: all enriched, some (partial), or none (keeps the failure status and code).
const pathStatus = (modules, fallback) => {
  const enriched = modules.filter((m) => aiStatusOf(m) === 'enriched').length;
  if (modules.length && enriched === modules.length) return 'enriched';
  return enriched ? 'partial' : fallback;
};

const summary = (doc) => {
  const p = view(doc);
  return { id: p.id, professionId: p.professionId, title: p.title, source: p.source, matchScore: p.matchScore,
    modules: p.modules.length, more: p.more?.count || 0, enrichment: p.enrichment?.status, progress: p.progress,
    totalHours: p.totalHours, createdAt: p.createdAt, updatedAt: p.updatedAt };
};

const ownPath = async (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return LearningPath.findOne({ _id: req.params.id, userId: req.user.userId });
};

const guarded = (message, handler) => async (req, res) => {
  try {
    return await handler(req, res);
  } catch (error) {
    return handleServerError(res, req, error, { module: 'learning-paths', message });
  }
};

// Build (structure + enrichment) for one career; used by create and regenerate.
export const buildPath = async (req, { professionId, choices, preferences }) => {
  let structure;
  try {
    structure = await requestStructure(req.user.userId, { profession_id: professionId, choices }, req);
  } catch {
    return { error: 'unavailable' };
  }
  if (structure.status !== 200 || !structure.data?.success) return { error: 'ai', ai: structure };
  const s = structure.data.data;
  // A module whose skill was already completed in another path (a learning skill) starts as completed.
  const profile = await Profile.findOne({ userId: req.user.userId }).select('skills').lean();
  const learned = new Set((profile?.skills?.learning || []).map((x) => x.toLowerCase()));
  let modules = s.modules.map(fromStructure)
    .map((m) => (learned.has(m.skill.toLowerCase()) ? { ...m, status: 'completed', completedAt: new Date() } : m));
  let enrichment = { status: 'unavailable' };
  let totalHours;
  let retryKeys = [];
  if (modules.length) {
    let code;
    try {
      const ai = await requestEnrichment(req.user.userId, enrichmentRequest(s.title, modules, profile, preferences, false), req);
      if (ai.status === 200 && ai.data?.success) {
        const e = ai.data.data;
        retryKeys = e.failed || [];
        modules = applyEnrichment(modules, e).map((m) => (retryKeys.includes(m.key) ? { ...m, aiStatus: 'pending' } : m));
        totalHours = totalHoursOf(modules);
        enrichment = { status: retryKeys.length ? 'partial' : 'enriched', code: retryKeys.length ? 'LLM_INVALID_OUTPUT' : '',
          prompt: e.usage?.prompt, model: e.usage?.model, cached: Boolean(e.usage?.cached) };
      } else {
        code = ai.data?.code || 'LLM_UNAVAILABLE';
      }
    } catch {
      code = 'LLM_UNAVAILABLE';
    }
    if (code) {
      const retry = RETRYABLE.has(code);
      retryKeys = retry ? modules.map((m) => m.key) : [];
      modules = modules.map((m) => ({ ...m, aiStatus: retry ? 'pending' : 'failed' }));
      enrichment = { status: code === 'LLM_INVALID_OUTPUT' ? 'failed' : 'unavailable', code };
    }
  }
  return {
    retryKeys,
    fields: {
      professionId, title: s.title, source: s.source, sourceVersion: s.source_version || '', matchScore: s.match_score,
      preferences, choices, modules, more: s.more, totalHours, enrichment,
      snapshot: { skillsHash: s.snapshot.skills_hash, datasetHash: s.snapshot.dataset_hash,
        scoringMode: s.snapshot.scoring_mode, algorithm: s.snapshot.algorithm },
    },
  };
};

export const createPath = guarded('Could not create the learning path', async (req, res) => {
  const { professionId } = req.body || {};
  const preferences = validPreferences(req.body?.preferences);
  const choices = validChoices(req.body?.choices);
  if (!PROFESSION_ID.test(professionId || '') || !preferences || !choices) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Choose a career and valid preferences.' });
  }
  const user = await User.findById(req.user.userId).select('aiConsent').lean();
  if (!hasConsent(user)) {
    return res.status(403).json({ success: false, code: 'AI_CONSENT_REQUIRED',
      message: 'Please agree to the AI processing notice to build a learning path.', data: consentView(user) });
  }
  if (await LearningPath.exists({ userId: req.user.userId, professionId })) {
    return res.status(409).json({ success: false, code: 'PATH_EXISTS', message: 'You already have a learning path for this career.' });
  }
  if (await LearningPath.countDocuments({ userId: req.user.userId }) >= MAX_PATHS) {
    return res.status(409).json({ success: false, code: 'PATH_LIMIT', message: `You can keep at most ${MAX_PATHS} learning paths. Delete one first.` });
  }
  const built = await buildPath(req, { professionId, choices, preferences });
  if (built.error === 'unavailable') return unavailable(res);
  if (built.error) return passThrough(res, built.ai);
  const path = await LearningPath.create({ userId: req.user.userId, ...built.fields });
  scheduleRetry(path._id, req.user.userId, built.retryKeys);
  return res.status(201).json({ success: true, data: view(path) });
});

const consentRequired = (res, user, message) => res.status(403).json({ success: false, code: 'AI_CONSENT_REQUIRED',
  message, data: consentView(user) });
const notFound = (res) => res.status(404).json({ success: false, code: 'PATH_NOT_FOUND', message: 'Learning path not found.' });
const noModule = (res) => res.status(404).json({ success: false, code: 'MODULE_NOT_FOUND', message: 'Module not found.' });

export const listPaths = guarded('Could not load your learning paths', async (req, res) => {
  const paths = await LearningPath.find({ userId: req.user.userId }).sort({ updatedAt: -1 });
  return res.json({ success: true, data: paths.map(summary), limit: MAX_PATHS });
});

export const getPath = guarded('Could not load the learning path', async (req, res) => {
  const path = await ownPath(req);
  if (!path) return res.status(404).json({ success: false, code: 'PATH_NOT_FOUND', message: 'Learning path not found.' });
  return res.json({ success: true, data: view(path) });
});

// Completing a module adds its skill to the profile as a learning skill (unless the profile already has it under
// any source); taking the completion back removes only that learning skill. The profile change re-embeds the skills
// and the career-match cache refreshes (its key contains the skills).
const setLearningSkill = async (userId, skill, add) => {
  const before = await Profile.findOne({ userId }).select('skills').lean();
  if (!before) return;
  const lower = skill.toLowerCase();
  const has = (list) => (before.skills?.[list] || []).some((s) => s.toLowerCase() === lower);
  if (add && ['manual', 'cv', 'extracted', 'learning'].some(has)) return;
  if (!add && !has('learning')) return;
  const update = add ? { $push: { 'skills.learning': skill } }
    : { $pull: { 'skills.learning': { $in: (before.skills.learning || []).filter((s) => s.toLowerCase() === lower) } } };
  const after = await Profile.findOneAndUpdate({ userId }, update, { new: true }).select('skills').lean();
  syncSkillsIfChanged(userId, before, after);
};

export const updateModule = guarded('Could not update the module', async (req, res) => {
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Unknown module status.' });
  }
  const path = await ownPath(req);
  if (!path) return res.status(404).json({ success: false, code: 'PATH_NOT_FOUND', message: 'Learning path not found.' });
  const module = path.modules.find((m) => m.key === req.params.key);
  if (!module) return res.status(404).json({ success: false, code: 'MODULE_NOT_FOUND', message: 'Module not found.' });
  const was = module.status;
  module.status = status;
  if (status === 'in_progress' && !module.startedAt) module.startedAt = new Date();
  module.completedAt = status === 'completed' ? (module.completedAt || new Date()) : undefined;
  await path.save();
  if (status === 'completed' && was !== 'completed') await setLearningSkill(req.user.userId, module.skill, true);
  if (was === 'completed' && status !== 'completed') await setLearningSkill(req.user.userId, module.skill, false);
  return res.json({ success: true, data: view(path) });
});

export const deletePath = guarded('Could not delete the learning path', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ success: false, code: 'PATH_NOT_FOUND', message: 'Learning path not found.' });
  }
  const result = await LearningPath.deleteOne({ _id: req.params.id, userId: req.user.userId });
  if (!result.deletedCount) return res.status(404).json({ success: false, code: 'PATH_NOT_FOUND', message: 'Learning path not found.' });
  return res.json({ success: true });
});

// The path's snapshot against the user's profile skills (CV, profile, GitHub) and the career data now. Learning skills are not part of
// it (AIServices builds paths from profile skills), so completing modules never makes a path stale.
export const getFreshness = guarded('Could not check the learning path', async (req, res) => {
  const path = await ownPath(req);
  if (!path) return notFound(res);
  let state;
  try {
    state = await requestState(req.user.userId, req);
  } catch {
    state = null;
  }
  if (state?.status !== 200 || !state.data?.success) {
    return res.json({ success: true, data: { available: false, stale: false, profileChanged: false, dataChanged: false } });
  }
  const profileChanged = state.data.data.skills_hash !== path.snapshot?.skillsHash;
  const dataChanged = state.data.data.dataset_hash !== path.snapshot?.datasetHash;
  return res.json({ success: true, data: { available: true, stale: profileChanged || dataChanged, profileChanged, dataChanged } });
});

// Rebuild with the saved choices (and the saved or new preferences). A module that is still in the path keeps its
// status and dates; feedback is kept.
export const regeneratePath = guarded('Could not regenerate the learning path', async (req, res) => {
  const path = await ownPath(req);
  if (!path) return notFound(res);
  const saved = path.preferences?.toObject ? path.preferences.toObject() : path.preferences;
  const preferences = validPreferences({ ...saved, ...(req.body?.preferences || {}) });
  if (!preferences) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Choose valid preferences.' });
  const user = await User.findById(req.user.userId).select('aiConsent').lean();
  if (!hasConsent(user)) return consentRequired(res, user, 'Please agree to the AI processing notice to rebuild this learning path.');
  const built = await buildPath(req, { professionId: path.professionId, choices: path.choices || {}, preferences });
  if (built.error === 'unavailable') return unavailable(res);
  if (built.error) return passThrough(res, built.ai);
  const before = new Map(path.modules.map((m) => [m.key, m]));
  built.fields.modules = built.fields.modules.map((m) => {
    const old = before.get(m.key);
    return old && old.status !== 'not_started'
      ? { ...m, status: old.status, startedAt: old.startedAt, completedAt: old.completedAt } : m;
  });
  path.set(built.fields);
  await path.save();
  scheduleRetry(path._id, req.user.userId, built.retryKeys);
  return res.json({ success: true, data: view(path) });
});

// Thumbs up / down on one recommendation (vote null takes it back). One vote per recommendation.
export const setFeedback = guarded('Could not save your feedback', async (req, res) => {
  const { title, vote } = req.body || {};
  if (typeof title !== 'string' || !(vote === null || VOTES.includes(vote))) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Choose a resource and a vote.' });
  }
  const path = await ownPath(req);
  if (!path) return notFound(res);
  const module = path.modules.find((m) => m.key === req.params.key);
  if (!module) return noModule(res);
  if (!module.recommendations.some((r) => r.title === title)) {
    return res.status(404).json({ success: false, code: 'RESOURCE_NOT_FOUND', message: 'Resource not found.' });
  }
  path.feedback = path.feedback.filter((f) => !(f.moduleKey === module.key && f.title === title));
  if (vote) path.feedback.push({ moduleKey: module.key, title, vote, at: new Date() });
  await path.save();
  return res.json({ success: true, data: view(path) });
});

// "Suggest another resource": the LLM proposes resources not shown yet (AIServices excludes the titles and builds the
// search links); they are added to the module, up to MAX_RECOMMENDATIONS.
export const suggestMore = guarded('Could not suggest another resource', async (req, res) => {
  const path = await ownPath(req);
  if (!path) return notFound(res);
  const module = path.modules.find((m) => m.key === req.params.key);
  if (!module) return noModule(res);
  if (module.recommendations.length >= MAX_RECOMMENDATIONS) {
    return res.status(409).json({ success: false, code: 'MORE_LIMIT', message: `A module can list at most ${MAX_RECOMMENDATIONS} resources.` });
  }
  const user = await User.findById(req.user.userId).select('aiConsent').lean();
  if (!hasConsent(user)) return consentRequired(res, user, 'Please agree to the AI processing notice to get more suggestions.');
  let ai;
  try {
    ai = await requestMore(req.user.userId, {
      role_title: path.title, skill: module.skill, exclude_titles: module.recommendations.map((r) => r.title).slice(0, 30),
      preferences: { cost: path.preferences.cost, hours_per_week: path.preferences.hoursPerWeek },
    }, req);
  } catch {
    ai = null;
  }
  if (ai?.status !== 200 || !ai.data?.success) {
    return res.status(503).json({ success: false, code: 'SUGGESTION_UNAVAILABLE',
      message: 'No new suggestion is available right now. Please try again later.' });
  }
  const shown = new Set(module.recommendations.map((r) => r.title.toLowerCase()));
  const fresh = ai.data.data.recommendations.map(fromRecommendation).filter((r) => !shown.has(r.title.toLowerCase()));
  const added = fresh.slice(0, MAX_RECOMMENDATIONS - module.recommendations.length);
  module.recommendations.push(...added);
  await path.save();
  return res.json({ success: true, data: view(path), added: added.length });
});

// ─── AI details retry (automatic once in the background, or "Retry AI details") ─────────────────────────────────
// Fills the modules the LLM covers validly; the rest become "failed". The path is re-read, so a status change made
// meanwhile is kept. automatic: the user's daily AI quota is not used.
export const retryDetails = async (pathId, userId, keys, { automatic = false, req } = {}) => {
  const path = await LearningPath.findOne({ _id: pathId, userId });
  if (!path) return null;
  const targets = path.modules.filter((m) => keys.includes(m.key));
  if (!targets.length) return path;
  const profile = await Profile.findOne({ userId }).select('skills').lean();
  let e = null;
  let code = '';
  try {
    const ai = await requestEnrichment(userId, enrichmentRequest(path.title, targets, profile, path.preferences, automatic), req);
    if (ai.status === 200 && ai.data?.success) e = ai.data.data;
    else code = ai.data?.code || 'LLM_UNAVAILABLE';
  } catch {
    code = 'LLM_UNAVAILABLE';
  }
  const byKey = new Map((e?.modules || []).map((m) => [m.key, m]));
  for (const module of targets) {
    const details = byKey.get(module.key);
    if (details) Object.assign(module, detailsOf(details));
    else module.aiStatus = 'failed';
  }
  const status = pathStatus(path.modules, path.enrichment?.status === 'partial' ? 'failed' : (path.enrichment?.status || 'failed'));
  path.enrichment = { ...(path.enrichment?.toObject ? path.enrichment.toObject() : path.enrichment), status,
    code: status === 'enriched' ? '' : (code || 'LLM_INVALID_OUTPUT'),
    ...(e?.usage ? { prompt: e.usage.prompt, model: e.usage.model, cached: Boolean(e.usage.cached) } : {}) };
  path.totalHours = totalHoursOf(path.modules);
  await path.save();
  return path;
};

const pendingRetries = new Set();
const scheduleRetry = (pathId, userId, keys) => {
  if (!keys?.length) return;
  const job = retryDetails(pathId, userId, keys, { automatic: true })
    .catch(async () => {  // never leave modules "pending"
      await LearningPath.updateOne({ _id: pathId }, { $set: { 'modules.$[m].aiStatus': 'failed' } },
        { arrayFilters: [{ 'm.key': { $in: keys }, 'm.aiStatus': 'pending' }] }).catch(() => {});
    })
    .finally(() => pendingRetries.delete(job));
  pendingRetries.add(job);
};

// Tests: wait for the background retries.
export const flushLearningRetries = async () => {
  while (pendingRetries.size) await Promise.allSettled([...pendingRetries]);
};

export const retryEnrichment = guarded('Could not get the AI details', async (req, res) => {
  const path = await ownPath(req);
  if (!path) return notFound(res);
  const open = path.modules.filter((m) => aiStatusOf(m) !== 'enriched').map((m) => m.key);
  const asked = Array.isArray(req.body?.keys) ? req.body.keys.filter((k) => typeof k === 'string') : open;
  const keys = asked.filter((k) => open.includes(k));
  if (!keys.length) {
    return res.status(400).json({ success: false, code: 'NOTHING_TO_RETRY', message: 'These modules already have their AI details.' });
  }
  const user = await User.findById(req.user.userId).select('aiConsent').lean();
  if (!hasConsent(user)) return consentRequired(res, user, 'Please agree to the AI processing notice to get the AI details.');
  const updated = await retryDetails(path._id, req.user.userId, keys, { req });
  return res.json({ success: true, data: view(updated) });
});
