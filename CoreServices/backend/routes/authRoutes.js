import express from 'express';
import {
  register,
  login,
  getProfile,
  updateProfile,
  forgotPassword,
  resetPassword,
  getCVStatus,
} from '../controllers/authController.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);

// Protected routes
router.get('/profile', authMiddleware, getProfile);
router.put('/profile', authMiddleware, updateProfile);

// CV status is read-only here; it is written only by AIServices via /internal routes.
router.get('/cv-status', authMiddleware, getCVStatus);

export default router;
