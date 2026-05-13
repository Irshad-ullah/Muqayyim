import InterviewDomain from '../models/InterviewDomain.js';
import QuestionBank from '../models/QuestionBank.js';
import { auditLog } from '../utils/auditLog.js';

// ─── Interview Domains ────────────────────────────────────────────────────────

// @route   GET /api/admin/interview-domains
export const listDomains = async (req, res) => {
  try {
    const { isActive } = req.query;
    const filter = isActive !== undefined ? { isActive: isActive === 'true' } : {};
    const domains = await InterviewDomain.find(filter)
      .populate('parentDomain', 'name')
      .sort({ name: 1 });
    return res.json({ success: true, data: domains });
  } catch (error) {
    console.error('List domains error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch domains' });
  }
};

// @route   POST /api/admin/interview-domains
export const createDomain = async (req, res) => {
  try {
    const { name, description, parentDomain } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    const domain = await InterviewDomain.create({ name, description, parentDomain: parentDomain || null });
    await auditLog(req.user.userId, 'CREATE_INTERVIEW_DOMAIN', 'InterviewDomain', domain._id, { name }, req);
    return res.status(201).json({ success: true, data: domain });
  } catch (error) {
    console.error('Create domain error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create domain' });
  }
};

// @route   PUT /api/admin/interview-domains/:id
export const updateDomain = async (req, res) => {
  try {
    const domain = await InterviewDomain.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });

    await auditLog(req.user.userId, 'UPDATE_INTERVIEW_DOMAIN', 'InterviewDomain', domain._id, {}, req);
    return res.json({ success: true, data: domain });
  } catch (error) {
    console.error('Update domain error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update domain' });
  }
};

// @route   DELETE /api/admin/interview-domains/:id
export const deleteDomain = async (req, res) => {
  try {
    // Prevent deletion if questions reference this domain
    const questionCount = await QuestionBank.countDocuments({ domain: req.params.id });
    if (questionCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete: ${questionCount} question(s) are linked to this domain`,
      });
    }

    const domain = await InterviewDomain.findByIdAndDelete(req.params.id);
    if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });

    await auditLog(req.user.userId, 'DELETE_INTERVIEW_DOMAIN', 'InterviewDomain', domain._id, { name: domain.name }, req);
    return res.json({ success: true, message: 'Domain deleted' });
  } catch (error) {
    console.error('Delete domain error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete domain' });
  }
};

// ─── Question Bank ────────────────────────────────────────────────────────────

// @route   GET /api/admin/questions
export const listQuestions = async (req, res) => {
  try {
    const { page = 1, limit = 20, domain, difficulty, type, isActive } = req.query;

    const filter = {};
    if (domain) filter.domain = domain;
    if (difficulty) filter.difficulty = difficulty;
    if (type) filter.type = type;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [questions, total] = await Promise.all([
      QuestionBank.find(filter)
        .populate('domain', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      QuestionBank.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: questions,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('List questions error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch questions' });
  }
};

// @route   POST /api/admin/questions
export const createQuestion = async (req, res) => {
  try {
    const { question, domain, difficulty, type, tags, expectedAnswer } = req.body;

    if (!question || !domain) {
      return res.status(400).json({ success: false, message: 'question and domain are required' });
    }

    const domainExists = await InterviewDomain.findById(domain);
    if (!domainExists) {
      return res.status(404).json({ success: false, message: 'Interview domain not found' });
    }

    const q = await QuestionBank.create({
      question, domain, difficulty, type, tags, expectedAnswer,
      createdBy: req.user.userId,
    });

    await auditLog(req.user.userId, 'CREATE_QUESTION', 'QuestionBank', q._id, { domain }, req);
    return res.status(201).json({ success: true, data: q });
  } catch (error) {
    console.error('Create question error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create question' });
  }
};

// @route   PUT /api/admin/questions/:id
export const updateQuestion = async (req, res) => {
  try {
    const q = await QuestionBank.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!q) return res.status(404).json({ success: false, message: 'Question not found' });

    await auditLog(req.user.userId, 'UPDATE_QUESTION', 'QuestionBank', q._id, {}, req);
    return res.json({ success: true, data: q });
  } catch (error) {
    console.error('Update question error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update question' });
  }
};

// @route   DELETE /api/admin/questions/:id
export const deleteQuestion = async (req, res) => {
  try {
    const q = await QuestionBank.findByIdAndDelete(req.params.id);
    if (!q) return res.status(404).json({ success: false, message: 'Question not found' });

    await auditLog(req.user.userId, 'DELETE_QUESTION', 'QuestionBank', q._id, {}, req);
    return res.json({ success: true, message: 'Question deleted' });
  } catch (error) {
    console.error('Delete question error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete question' });
  }
};
