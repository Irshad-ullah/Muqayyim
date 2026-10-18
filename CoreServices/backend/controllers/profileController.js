import Profile from "../models/Profile.js";
import {
  fetchUserRepos,
  extractSkillsFromRepos,
} from "../services/githubService.js";
import { handleServerError } from '../utils/serverError.js';
import { validateProfileUpdate } from '../validation/profileSchemas.js';
import { checkGithubUsername, checkSkillName, dedupeAcross } from '../validation/rules.js';
import { LIMITS } from '../validation/profileLimits.js';
import { sendValidationError } from '../validation/formatErrors.js';
import { syncSkillsIfChanged } from '../services/skillEmbeddingSync.js';

// GET /api/profile
export const getProfile = async (req, res) => {
  try {
    const profile = await Profile.findOne({ userId: req.user.userId });
    return res.status(200).json({ success: true, profile: profile || null });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'profile', message: "Failed to fetch profile" });
  }
};

// PUT /api/profile (also POST /api/profile/save)
// Partial update: only the sections present are validated — each one
// completely — and written. Unknown top-level keys are rejected; the
// allowlist is ALLOWED_FIELDS in validation/profileSchemas.js.
export const upsertProfile = async (req, res) => {
  try {
    const { data: update, errors } = validateProfileUpdate(req.body);
    if (errors.length) return sendValidationError(res, errors);

    // Skill embeddings (FR-B9): compare the merged skill set before and after.
    const before = await Profile.findOne({ userId: req.user.userId }).select('skills').lean();
    // The skills section sets only the user-editable lists, so skills.learning (Module 6) is never wiped by a save.
    if (update.skills) {
      for (const [list, values] of Object.entries(update.skills)) update[`skills.${list}`] = values;
      delete update.skills;
    }
    const profile = await Profile.findOneAndUpdate(
      { userId: req.user.userId },
      { $set: update },
      { new: true, upsert: true, runValidators: true },
    );
    syncSkillsIfChanged(req.user.userId, before, profile); // background; never affects the save

    return res
      .status(200)
      .json({ success: true, message: "Profile saved successfully", profile });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'profile', message: "Failed to save profile" });
  }
};

// POST /api/profile/github
export const fetchGitHubRepos = async (req, res) => {
  try {
    // FR5.8: 1–39 chars, letters/digits/single hyphens, no edge hyphen.
    const check = checkGithubUsername(req.body?.username, { required: true });
    if (check.error) return sendValidationError(res, [{ field: "username", message: check.error }]);
    const username = check.value;

    const repos = await fetchUserRepos(username);
    const extractedSkills = extractSkillsFromRepos(repos);

    const before = await Profile.findOne({ userId: req.user.userId }).select('skills').lean();
    const after = await Profile.findOneAndUpdate(
      { userId: req.user.userId },
      {
        $set: {
          "githubData.username": username,
          "githubData.repos": repos,
          "githubData.extractedSkills": extractedSkills,
          "githubData.lastSynced": new Date(),
        },
      },
      { new: true, upsert: true, runValidators: true },
    );
    syncSkillsIfChanged(req.user.userId, before, after); // only githubData changes here: normally a no-op

    return res.status(200).json({ success: true, repos, extractedSkills });
  } catch (error) {
    console.error("GitHub fetch error:", error);
    const status = error.message.includes("not found") ? 404 : 502;
    return res.status(status).json({ success: false, message: error.message });
  }
};

// POST /api/profile/extract-skills
// Merges skills from manual input, CV and GitHub. Case-insensitive
// de-duplication keeps the first spelling (manual first, then CV, then
// GitHub); the merged list must stay within the FR5.5 limits.
export const extractSkills = async (req, res) => {
  try {
    const errors = [];
    const read = (key) => {
      const value = req.body?.[key];
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) {
        errors.push({ field: key, message: "Must be a list" });
        return [];
      }
      return value.flatMap((item, i) => {
        const r = checkSkillName(item);
        if (r.error) errors.push({ field: `${key}[${i}]`, message: r.error });
        return r.value ? [r.value] : [];
      });
    };
    const manual = read("manualSkills");
    const cv = read("cvSkills");
    const github = read("githubSkills");
    if (errors.length) return sendValidationError(res, errors);

    const merged = dedupeAcross([manual, cv, github])
      .flat()
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    if (merged.length > LIMITS.skill.maxTotal) {
      return sendValidationError(res, [
        {
          field: "skills",
          message: `You can have at most ${LIMITS.skill.maxTotal} skills (the merge has ${merged.length}). Remove some first.`,
        },
      ]);
    }

    return res.status(200).json({ success: true, skills: merged });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'profile', message: "Failed to extract skills" });
  }
};
