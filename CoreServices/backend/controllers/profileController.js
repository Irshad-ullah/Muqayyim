import Profile from "../models/Profile.js";
import CvData from "../models/CvData.js";
import {
  fetchUserRepos,
  extractSkillsFromRepos,
} from "../services/githubService.js";

const ALLOWED_FIELDS = [
  "personalInfo",
  "summary",
  "experience",
  "education",
  "skills",
  "certifications",
  "projects",
  "githubData",
  "cvImportedAt",
  "cvData",
];

// GET /api/profile
export const getProfile = async (req, res) => {
  try {
    const profile = await Profile.findOne({ userId: req.user.userId });
    return res.status(200).json({ success: true, profile: profile || null });
  } catch (error) {
    console.error("Get profile error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch profile" });
  }
};

// PUT /api/profile
export const upsertProfile = async (req, res) => {
  try {
    const update = {};
    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }

    const profile = await Profile.findOneAndUpdate(
      { userId: req.user.userId },
      { $set: update },
      { new: true, upsert: true, runValidators: false },
    );

    return res
      .status(200)
      .json({ success: true, message: "Profile saved successfully", profile });
  } catch (error) {
    console.error("Upsert profile error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to save profile" });
  }
};

// POST /api/profile/github
export const fetchGitHubRepos = async (req, res) => {
  try {
    const { username } = req.body;
    if (!username?.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "GitHub username is required" });
    }

    const repos = await fetchUserRepos(username.trim());
    const extractedSkills = extractSkillsFromRepos(repos);

    await Profile.findOneAndUpdate(
      { userId: req.user.userId },
      {
        $set: {
          "githubData.username": username.trim(),
          "githubData.repos": repos,
          "githubData.extractedSkills": extractedSkills,
          "githubData.lastSynced": new Date(),
        },
      },
      { upsert: true },
    );

    return res.status(200).json({ success: true, repos, extractedSkills });
  } catch (error) {
    console.error("GitHub fetch error:", error);
    const status = error.message.includes("not found") ? 404 : 502;
    return res.status(status).json({ success: false, message: error.message });
  }
};

// GET /api/profile/cv-data
// Reads the most-recent CV parse record for this user from the AI Service's collection.
export const getCVData = async (req, res) => {
  try {
    const userId = req.user.userId.toString();
    const record = await CvData.findOne({ user_id: userId }, null, {
      sort: { upload_date: -1 },
    });

    if (!record) {
      return res
        .status(200)
        .json({ success: true, cvData: null, status: null });
    }

    return res.status(200).json({
      success: true,
      cvData: record.parsed_data,
      status: record.parsing_status,
      uploadDate: record.upload_date,
    });
  } catch (error) {
    console.error("Get CV data error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch CV data" });
  }
};

// POST /api/profile/extract-skills
// Merges skills from CV, GitHub, and manual input — deduplicates case-insensitively.
export const extractSkills = async (req, res) => {
  try {
    const { cvSkills = [], githubSkills = [], manualSkills = [] } = req.body;

    const seen = new Set();
    const merged = [...cvSkills, ...githubSkills, ...manualSkills]
      .map((s) => (typeof s === "string" ? s : (s?.name ?? "")).trim())
      .filter((s) => {
        if (!s) return false;
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    return res.status(200).json({ success: true, skills: merged });
  } catch (error) {
    console.error("Extract skills error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to extract skills" });
  }
};
