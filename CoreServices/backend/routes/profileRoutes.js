import express from "express";
import {
  getProfile,
  upsertProfile,
  fetchGitHubRepos,
  getCVData,
  extractSkills,
} from "../controllers/profileController.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();
router.use(authMiddleware);

router.get("/", getProfile);
router.put("/", upsertProfile);
router.post("/save", upsertProfile);
router.post("/github", fetchGitHubRepos);
router.get("/cv-data", getCVData);
router.post("/extract-skills", extractSkills);

export default router;
