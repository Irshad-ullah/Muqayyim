import mongoose from 'mongoose';
import GeneratedCv from '../models/GeneratedCv.js';
import { buildCvSource, DEFAULT_SETTINGS } from '../services/cvSourceService.js';
import { sanitizeCvData } from '../utils/cvSanitizer.js';
import { handleServerError } from '../utils/serverError.js';
import { incompleteMessage, missingForGeneration, validateCvPayload } from '../validation/cvSchemas.js';
import { sendValidationError } from '../validation/formatErrors.js';

const MAX_SAVED_CVS = 50;

// Every lookup is scoped to the authenticated user from the JWT, so changing
// an id in the URL can never reach another user's CV (returns 404 instead).
const findOwned = (req) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return GeneratedCv.findOne({ _id: id, userId: req.user.userId });
};

// Validates a create/update payload. Sends the 400 itself and returns null
// when the payload is rejected:
//   PROFILE_INCOMPLETE (FR6.8) — no name, or none of experience/education/
//                                projects/skills; `missing` lists what to add.
//   VALIDATION_ERROR           — field rules, with errors[].field paths.
const readPayload = (req, res) => {
  const result = validateCvPayload(req.body);
  if (result.missing) {
    res.status(400).json({
      success: false,
      code: 'PROFILE_INCOMPLETE',
      message: incompleteMessage(result.missing),
      missing: result.missing,
    });
    return null;
  }
  if (result.errors) {
    sendValidationError(res, result.errors);
    return null;
  }
  return result.value;
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
      warnings: (() => {
        const missing = missingForGeneration(clean);
        return missing.length ? [incompleteMessage(missing)] : [];
      })(),
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'cv-generator', message: 'Failed to load your profile data' });
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
    return handleServerError(res, req, error, { module: 'cv-generator', message: 'Failed to fetch saved CVs' });
  }
};

// GET /api/generated-cvs/:id
export const getCv = async (req, res) => {
  try {
    const cv = await findOwned(req)?.lean();
    if (!cv) return res.status(404).json({ success: false, message: 'CV not found' });
    return res.status(200).json({ success: true, cv });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'cv-generator', message: 'Failed to fetch CV' });
  }
};

// POST /api/generated-cvs
export const createCv = async (req, res) => {
  try {
    const payload = readPayload(req, res);
    if (!payload) return undefined;
    const { title, template, settings, data } = payload;

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
      title: title || `${data.personal.fullName} CV`.slice(0, 100),
      template,
      settings,
      data,
      sources: { profile: !!sources.profile, parsedCv: !!sources.parsedCv },
      snapshotAt: new Date(),
    });

    return res.status(201).json({ success: true, message: 'CV saved', cv });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'cv-generator', message: 'Failed to save CV' });
  }
};

// PUT /api/generated-cvs/:id
export const updateCv = async (req, res) => {
  try {
    const payload = readPayload(req, res);
    if (!payload) return undefined;
    const { title, template, settings, data } = payload;

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
    if (error.name === 'CastError' && error.path === '_id') {
      return res.status(404).json({ success: false, message: 'CV not found' });
    }
    return handleServerError(res, req, error, { module: 'cv-generator', message: 'Failed to update CV' });
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
    return handleServerError(res, req, error, { module: 'cv-generator', message: 'Failed to delete CV' });
  }
};
