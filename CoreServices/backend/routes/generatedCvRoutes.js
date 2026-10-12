import express from 'express';
import {
  getCvSource,
  listCvs,
  getCv,
  createCv,
  updateCv,
  deleteCv,
} from '../controllers/generatedCvController.js';
import authMiddleware from '../middleware/auth.js';

// Module 4 — AI-Powered CV Generator
const router = express.Router();
router.use(authMiddleware);

router.get('/source', getCvSource);
router.get('/', listCvs);
router.post('/', createCv);
router.get('/:id', getCv);
router.put('/:id', updateCv);
router.delete('/:id', deleteCv);

export default router;
