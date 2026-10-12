import mongoose from 'mongoose';
import GeneratedCv from '../models/GeneratedCv.js';
import { buildCvSource, DEFAULT_SETTINGS } from '../services/cvSourceService.js';
import {
  sanitizeCvData,
  sanitizeSettings,
  sanitizeTemplate,
  validateCvData,
} from '../utils/cvSanitizer.js';

const MAX_SAVED_CVS = 50;

// Every lookup is scoped to the authenticated user from the JWT, so changing
// an id in the URL can never reach another user's CV (returns 404 instead).
const findOwned = (req) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return GeneratedCv.findOne({ _id: id, userId: req.user.userId });
};

const readPayload = (body = {}) => {
  const data = sanitizeCvData(body.data);
  return {
    title: typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '',
    template: sanitizeTemplate(body.template),
    settings: sanitizeSettings(body.settings),
    data,
    errors: validateCvData(data),
  };
};

// GET /api/generated-cvs/source
// Normalized CV content assembled from the user's Profile Builder + parsed CV data.
export const getCvSource = async (req, res) => {
  try {
    const { data, sources } = await buildCvSource(req.user.userId);
    const clean = sanitizeCvData(data);
    return res.status(200).json({
      success: true,
      data: clean,
      settings: DEFAULT_SETTINGS,
      sources,
      warnings: validateCvData(clean),
    });
  } catch (error) {
    console.error('CV source error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load your profile data' });
  }
};

// GET /api/generated-cvs
export const listCvs = async (req, res) => {
  try {
    const cvs = await GeneratedCv.find({ userId: req.user.userId })
      .select('title template settings.accentColor createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .lean();
    return res.status(200).json({ success: true, cvs });
  } catch (error) {
    console.error('List CVs error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch saved CVs' });
  }
};

// GET /api/generated-cvs/:id
export const getCv = async (req, res) => {
  try {
    const cv = await findOwned(req)?.lean();
    if (!cv) return res.status(404).json({ success: false, message: 'CV not found' });
    return res.status(200).json({ success: true, cv });
  } catch (error) {
    console.error('Get CV error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch CV' });
  }
};

// POST /api/generated-cvs
export const createCv = async (req, res) => {
  try {
    const { title, template, settings, data, errors } = readPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors[0], errors });
    }

    const count = await GeneratedCv.countDocuments({ userId: req.user.userId });
    if (count >= MAX_SAVED_CVS) {
      return res.status(400).json({
        success: false,
        message: `You can keep up to ${MAX_SAVED_CVS} saved CVs. Delete an old one first.`,
      });
    }

    const sources = req.body.sources || {};
    const cv = await GeneratedCv.create({
      userId: req.user.userId,
      title: title || `${data.personal.fullName} CV`,
      template,
      settings,
      data,
      sources: { profile: !!sources.profile, parsedCv: !!sources.parsedCv },
      snapshotAt: new Date(),
    });

    return res.status(201).json({ success: true, message: 'CV saved', cv });
  } catch (error) {
    console.error('Create CV error:', error);
    return res.status(500).json({ success: false, message: 'Failed to save CV' });
  }
};

// PUT /api/generated-cvs/:id
export const updateCv = async (req, res) => {
  try {
    const { title, template, settings, data, errors } = readPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors[0], errors });
    }

    const update = { template, settings, data };
    if (title) update.title = title;
    if (req.body.resnapshot === true) update.snapshotAt = new Date();

    const cv = await GeneratedCv.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      { $set: update },
      { new: true, runValidators: true },
    );
    if (!cv) return res.status(404).json({ success: false, message: 'CV not found' });

    return res.status(200).json({ success: true, message: 'CV updated', cv });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'CV not found' });
    }
    console.error('Update CV error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update CV' });
  }
};

// DELETE /api/generated-cvs/:id
export const deleteCv = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, message: 'CV not found' });
    }
    const result = await GeneratedCv.deleteOne({ _id: req.params.id, userId: req.user.userId });
    if (!result.deletedCount) {
      return res.status(404).json({ success: false, message: 'CV not found' });
    }
    return res.status(200).json({ success: true, message: 'CV deleted' });
  } catch (error) {
    console.error('Delete CV error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete CV' });
  }
};
