import express from 'express';
import { createPath, deletePath, getPath, listPaths, updateModule } from '../controllers/learningPathController.js';
import authMiddleware from '../middleware/auth.js';

// Module 6 — Learning paths (the signed-in user's own paths only)
const router = express.Router();
router.use(authMiddleware);

router.get('/', listPaths);
router.post('/', createPath);
router.get('/:id', getPath);
router.patch('/:id/modules/:key', updateModule);
router.delete('/:id', deletePath);

export default router;
