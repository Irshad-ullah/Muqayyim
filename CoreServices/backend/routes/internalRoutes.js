import express from 'express';
import requireInternalKey from '../middleware/internalAuth.js';
import { setUserCvStatus, getUserAuthState } from '../controllers/internalController.js';

// Service-to-service routes. Mounted at /internal (not /api) and never
// proxied by the API Gateway.
const router = express.Router();
router.use(requireInternalKey);

router.put('/users/:userId/cv-status', setUserCvStatus);
router.get('/users/:userId/auth-state', getUserAuthState);

export default router;
