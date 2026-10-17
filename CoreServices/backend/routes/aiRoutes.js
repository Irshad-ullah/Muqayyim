import express from 'express';
import { cvAssist, getConsent, getStatus, giveConsent, withdrawConsent } from '../controllers/aiController.js';
import authMiddleware from '../middleware/auth.js';

// LLM features (12) — the signed-in user's own AI consent and CV assist.
const router = express.Router();
router.use(authMiddleware);

router.get('/status', getStatus);
router.get('/consent', getConsent);
router.post('/consent', giveConsent);
router.delete('/consent', withdrawConsent);
router.post('/cv-assist', cvAssist);

export default router;
