import express from 'express';
import { getMatch, listMatches } from '../controllers/careerMatchController.js';
import authMiddleware from '../middleware/auth.js';

// Module 5 — Semantic Career Matching (the signed-in user's own matches only)
const router = express.Router();
router.use(authMiddleware);

router.get('/', listMatches);
router.get('/:professionId', getMatch);

export default router;
