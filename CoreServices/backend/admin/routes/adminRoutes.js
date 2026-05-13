import express from 'express';
import { adminAuthMiddleware } from '../middleware/adminMiddleware.js';

import { createAdminUser } from '../controllers/adminAuthController.js';
import { getDashboardMetrics, getDashboardSummary } from '../controllers/adminDashboardController.js';
import { listUsers, getUserById, updateUser, toggleUserStatus, updateUserRole, deleteUser } from '../controllers/adminUserController.js';
import { getSystemHealth, getSystemStatus, getAdminLogs } from '../controllers/adminSystemController.js';
import { getAllConfigs, createConfig, updateConfig, deleteConfig } from '../controllers/adminConfigController.js';
import {
  listProfessions, createProfession, updateProfession, deleteProfession,
  listSkills, createSkill, updateSkill, deleteSkill,
} from '../controllers/adminProfessionController.js';
import {
  listDomains, createDomain, updateDomain, deleteDomain,
  listQuestions, createQuestion, updateQuestion, deleteQuestion,
} from '../controllers/adminInterviewController.js';

const router = express.Router();

// ─── Admin Account Management ─────────────────────────────────────────────────
// Existing admins can promote users or create new admin accounts.
// First admin must be created via the seed utility (adminSeed.js).
router.post('/auth/create-admin', adminAuthMiddleware, createAdminUser);

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard/metrics', adminAuthMiddleware, getDashboardMetrics);
router.get('/dashboard/summary', adminAuthMiddleware, getDashboardSummary);

// ─── User Management ──────────────────────────────────────────────────────────
router.get('/users', adminAuthMiddleware, listUsers);
router.get('/users/:id', adminAuthMiddleware, getUserById);
router.put('/users/:id', adminAuthMiddleware, updateUser);
router.patch('/users/:id/status', adminAuthMiddleware, toggleUserStatus);
router.patch('/users/:id/role', adminAuthMiddleware, updateUserRole);
router.delete('/users/:id', adminAuthMiddleware, deleteUser);

// ─── System Health & Monitoring ───────────────────────────────────────────────
router.get('/system/health', adminAuthMiddleware, getSystemHealth);
router.get('/system/status', adminAuthMiddleware, getSystemStatus);
router.get('/system/logs', adminAuthMiddleware, getAdminLogs);

// ─── System Configuration ─────────────────────────────────────────────────────
router.get('/config', adminAuthMiddleware, getAllConfigs);
router.post('/config', adminAuthMiddleware, createConfig);
router.put('/config/:key', adminAuthMiddleware, updateConfig);
router.delete('/config/:key', adminAuthMiddleware, deleteConfig);

// ─── Profession Database & Skill Taxonomy ────────────────────────────────────
router.get('/professions', adminAuthMiddleware, listProfessions);
router.post('/professions', adminAuthMiddleware, createProfession);
router.put('/professions/:id', adminAuthMiddleware, updateProfession);
router.delete('/professions/:id', adminAuthMiddleware, deleteProfession);

router.get('/skills', adminAuthMiddleware, listSkills);
router.post('/skills', adminAuthMiddleware, createSkill);
router.put('/skills/:id', adminAuthMiddleware, updateSkill);
router.delete('/skills/:id', adminAuthMiddleware, deleteSkill);

// ─── Interview Domains & Question Bank ───────────────────────────────────────
router.get('/interview-domains', adminAuthMiddleware, listDomains);
router.post('/interview-domains', adminAuthMiddleware, createDomain);
router.put('/interview-domains/:id', adminAuthMiddleware, updateDomain);
router.delete('/interview-domains/:id', adminAuthMiddleware, deleteDomain);

router.get('/questions', adminAuthMiddleware, listQuestions);
router.post('/questions', adminAuthMiddleware, createQuestion);
router.put('/questions/:id', adminAuthMiddleware, updateQuestion);
router.delete('/questions/:id', adminAuthMiddleware, deleteQuestion);

export default router;
