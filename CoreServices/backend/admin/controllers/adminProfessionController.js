import Profession from '../models/Profession.js';
import SkillTaxonomy from '../models/SkillTaxonomy.js';
import { auditLog } from '../utils/auditLog.js';

// ─── Professions ──────────────────────────────────────────────────────────────

// @route   GET /api/admin/professions
export const listProfessions = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, category, isActive } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) filter.$text = { $search: search };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [professions, total] = await Promise.all([
      Profession.find(filter).sort({ title: 1 }).skip(skip).limit(parseInt(limit)),
      Profession.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: professions,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('List professions error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch professions' });
  }
};

// @route   POST /api/admin/professions
export const createProfession = async (req, res) => {
  try {
    const { title, code, source, category, description, alternativeTitles, requiredSkills } = req.body;

    if (!title) return res.status(400).json({ success: false, message: 'title is required' });

    const profession = await Profession.create({
      title, code, source, category, description, alternativeTitles, requiredSkills,
    });

    await auditLog(req.user.userId, 'CREATE_PROFESSION', 'Profession', profession._id, { title }, req);
    return res.status(201).json({ success: true, data: profession });
  } catch (error) {
    console.error('Create profession error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create profession' });
  }
};

// @route   PUT /api/admin/professions/:id
export const updateProfession = async (req, res) => {
  try {
    const profession = await Profession.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!profession) return res.status(404).json({ success: false, message: 'Profession not found' });

    await auditLog(req.user.userId, 'UPDATE_PROFESSION', 'Profession', profession._id, {}, req);
    return res.json({ success: true, data: profession });
  } catch (error) {
    console.error('Update profession error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update profession' });
  }
};

// @route   DELETE /api/admin/professions/:id
export const deleteProfession = async (req, res) => {
  try {
    const profession = await Profession.findByIdAndDelete(req.params.id);
    if (!profession) return res.status(404).json({ success: false, message: 'Profession not found' });

    await auditLog(req.user.userId, 'DELETE_PROFESSION', 'Profession', profession._id, { title: profession.title }, req);
    return res.json({ success: true, message: 'Profession deleted' });
  } catch (error) {
    console.error('Delete profession error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete profession' });
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
    console.error('List skills error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch skills' });
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
    console.error('Create skill error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create skill' });
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
    console.error('Update skill error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update skill' });
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
    console.error('Delete skill error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete skill' });
  }
};
