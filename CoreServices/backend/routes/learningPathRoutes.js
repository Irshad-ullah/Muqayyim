import express from 'express';
import { createPath, deletePath, getFreshness, getPath, listPaths, regeneratePath, setFeedback, suggestMore, updateModule } from '../controllers/learningPathController.js';
import authMiddleware from '../middleware/auth.js';

// Module 6 — Learning paths (the signed-in user's own paths only)
const router = express.Router();
router.use(authMiddleware);

router.get('/', listPaths);
router.post('/', createPath);
router.get('/:id', getPath);
router.get('/:id/freshness', getFreshness);
router.post('/:id/regenerate', regeneratePath);
router.patch('/:id/modules/:key', updateModule);
router.post('/:id/modules/:key/feedback', setFeedback);
router.post('/:id/modules/:key/more', suggestMore);
router.delete('/:id', deletePath);

export default router;
