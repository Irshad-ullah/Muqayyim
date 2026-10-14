import SkillTaxonomy from '../models/SkillTaxonomy.js';
import { auditLog } from '../utils/auditLog.js';
import { handleServerError } from '../../utils/serverError.js';
import { professionsCall } from '../../services/aiServiceClient.js';

// ─── Professions ──────────────────────────────────────────────────────────────
// The profession database lives in AIServices (ai_db.professions: O*NET, ESCO
// and manual professions, plus the role-skill index). These endpoints keep
// their paths and envelopes and pass through to /internal/professions.
// AdminLog entries are still written here. AIServices down → 503.

const unavailable = (res) =>
  res.status(503).json({
    success: false,
    code: 'PROFESSIONS_UNAVAILABLE',
    message: 'The profession database is temporarily unavailable. Please try again shortly.',
  });

// The old Core field names are returned alongside the AIServices ones.
export const toAdminProfession = (p) =>
  p && {
    ...p,
    _id: p.profession_id,
    code: p.source_code || '',
    alternativeTitles: p.alt_titles || [],
    requiredSkills: (p.skills || []).map((s) => s.name),
    isActive: Boolean(p.active),
  };

// Request body: accepts the old Core names (code, alternativeTitles,
// requiredSkills, isActive) and the AIServices names. Anything else is dropped.
const pick = (body, oldName, newName) => (body[newName] !== undefined ? body[newName] : body[oldName]);
export const toAiBody = (body = {}) => {
  const out = {};
  for (const field of ['title', 'description', 'category']) {
    if (body[field] !== undefined) out[field] = body[field];
  }
  const sourceCode = pick(body, 'code', 'source_code');
  if (sourceCode !== undefined) out.source_code = sourceCode;
  const altTitles = pick(body, 'alternativeTitles', 'alt_titles');
  if (altTitles !== undefined) out.alt_titles = altTitles;
  const active = pick(body, 'isActive', 'active');
  if (active !== undefined) out.active = active;
  const skills = pick(body, 'requiredSkills', 'skills');
  if (skills !== undefined) {
    out.skills = Array.isArray(skills)
      ? skills.map((s) => (typeof s === 'string' ? { name: s } : { name: s?.name, ...(s?.type ? { type: s.type } : {}) }))
      : skills;
  }
  return out;
};

// AIServices 4xx → the same status (its 422 validation error → Core's 400 VALIDATION_ERROR).
const passError = (res, result) => {
  const body = result.data || {};
  const status = result.status === 422 ? 400 : result.status;
  return res.status(status).json({
    success: false,
    code: body.code || (status === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED'),
    message: body.message || (status === 404 ? 'Profession not found' : 'Request failed'),
    ...(body.errors ? { errors: body.errors } : {}),
  });
};

const actorOf = (req) => String(req.user?.userId || '');

// @route   GET /api/admin/professions
export const listProfessions = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, category, isActive, source } = req.query;
    const params = { page, limit };
    if (search) params.search = search;
    if (category) params.category = category;
    if (isActive !== undefined) params.active = isActive === 'true';
    if (source) params.source = source;

    const result = await professionsCall('profession list', { path: '/professions', params }, req);
    if (!result.ok) return unavailable(res);
    if (result.status >= 400) return passError(res, result);
    return res.json({
      success: true,
      data: (result.data.data || []).map(toAdminProfession),
      pagination: result.data.pagination,
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to fetch professions' });
  }
};

// @route   POST /api/admin/professions  (always a manual profession)
export const createProfession = async (req, res) => {
  try {
    if (!req.body?.title) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'title is required' });
    }

    const data = { ...toAiBody(req.body), actor: actorOf(req) };
    const result = await professionsCall('profession create', { method: 'post', path: '/professions', data }, req);
    if (!result.ok) return unavailable(res);
    if (result.status >= 400) return passError(res, result);

    const profession = result.data.data;
    await auditLog(req.user.userId, 'CREATE_PROFESSION', 'Profession', profession.profession_id, { title: profession.title }, req);
    return res.status(201).json({ success: true, data: toAdminProfession(profession) });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to create profession' });
  }
};

// @route   PUT /api/admin/professions/:id  (O*NET / ESCO professions: category and isActive only)
export const updateProfession = async (req, res) => {
  try {
    const data = { ...toAiBody(req.body), actor: actorOf(req) };
    const path = `/professions/${encodeURIComponent(req.params.id)}`;
    const result = await professionsCall('profession update', { method: 'patch', path, data }, req);
    if (!result.ok) return unavailable(res);
    if (result.status >= 400) return passError(res, result);

    const profession = result.data.data;
    const fields = Object.keys(toAiBody(req.body));
    await auditLog(req.user.userId, 'UPDATE_PROFESSION', 'Profession', profession.profession_id, { fields }, req);
    return res.json({ success: true, data: toAdminProfession(profession) });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to update profession' });
  }
};

// @route   DELETE /api/admin/professions/:id  (soft delete: the profession becomes inactive)
export const deleteProfession = async (req, res) => {
  try {
    const path = `/professions/${encodeURIComponent(req.params.id)}`;
    const result = await professionsCall('profession delete', { method: 'delete', path, params: { actor: actorOf(req) } }, req);
    if (!result.ok) return unavailable(res);
    if (result.status >= 400) return passError(res, result);

    const profession = result.data.data;
    await auditLog(req.user.userId, 'DELETE_PROFESSION', 'Profession', profession.profession_id, { title: profession.title }, req);
    return res.json({ success: true, message: 'Profession deleted' });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to delete profession' });
  }
};

// ─── Skill Taxonomy ───────────────────────────────────────────────────────────

// @route   GET /api/admin/skills
export const listSkills = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, category, isActive } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) filter.$text = { $search: search };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [skills, total] = await Promise.all([
      SkillTaxonomy.find(filter).sort({ category: 1, name: 1 }).skip(skip).limit(parseInt(limit)),
      SkillTaxonomy.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: skills,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to fetch skills' });
  }
};

// @route   POST /api/admin/skills
export const createSkill = async (req, res) => {
  try {
    const { name, category, subcategory, aliases, relatedProfessions, source } = req.body;

    if (!name || !category) {
      return res.status(400).json({ success: false, message: 'name and category are required' });
    }

    const skill = await SkillTaxonomy.create({ name, category, subcategory, aliases, relatedProfessions, source });

    await auditLog(req.user.userId, 'CREATE_SKILL', 'SkillTaxonomy', skill._id, { name, category }, req);
    return res.status(201).json({ success: true, data: skill });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Skill name already exists' });
    }
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to create skill' });
  }
};

// @route   PUT /api/admin/skills/:id
export const updateSkill = async (req, res) => {
  try {
    const skill = await SkillTaxonomy.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!skill) return res.status(404).json({ success: false, message: 'Skill not found' });

    await auditLog(req.user.userId, 'UPDATE_SKILL', 'SkillTaxonomy', skill._id, {}, req);
    return res.json({ success: true, data: skill });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to update skill' });
  }
};

// @route   DELETE /api/admin/skills/:id
export const deleteSkill = async (req, res) => {
  try {
    const skill = await SkillTaxonomy.findByIdAndDelete(req.params.id);
    if (!skill) return res.status(404).json({ success: false, message: 'Skill not found' });

    await auditLog(req.user.userId, 'DELETE_SKILL', 'SkillTaxonomy', skill._id, { name: skill.name }, req);
    return res.json({ success: true, message: 'Skill deleted' });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to delete skill' });
  }
};
