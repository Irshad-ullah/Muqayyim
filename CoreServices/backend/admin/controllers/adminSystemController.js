import mongoose from 'mongoose';
import os from 'os';
import http from 'http';
import https from 'https';
import AdminLog from '../models/AdminLog.js';
import User from '../../models/User.js';
import Profile from '../../models/Profile.js';

// ── Internal helper: HTTP(S) ping with timeout ────────────────────────────────
// Uses Node built-in http/https — no extra dependencies.
const pingService = (urlStr, timeoutMs = 4000) =>
  new Promise((resolve) => {
    const start = Date.now();
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, responseTimeMs: Date.now() - start });
    };

    let url;
    try {
      url = new URL(urlStr);
    } catch {
      return done({ status: 'unhealthy', error: 'invalid URL' });
    }

    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.get(urlStr, (res) => {
      res.resume(); // drain
      done({
        status: res.statusCode >= 200 && res.statusCode < 300 ? 'healthy' : 'degraded',
        statusCode: res.statusCode,
      });
    });

    const timer = setTimeout(() => {
      req.destroy();
      done({ status: 'unhealthy', error: 'timeout' });
    }, timeoutMs);

    req.on('error', (err) => {
      clearTimeout(timer);
      done({ status: 'unhealthy', error: err.message });
    });

    req.on('close', () => clearTimeout(timer));
  });

// @route   GET /api/admin/system/health
// @desc    Live health of all services + system resources
// @access  Admin
export const getSystemHealth = async (req, res) => {
  const aiServiceUrl = process.env.CV_SERVICE_URL || 'http://localhost:8000';

  // Run all checks concurrently
  const [aiPing, userCount, profileCount] = await Promise.all([
    pingService(`${aiServiceUrl}/health`),
    User.countDocuments().catch(() => null),
    Profile.countDocuments().catch(() => null),
  ]);

  // ── MongoDB ─────────────────────────────────────────────────────────────────
  const mongoState = mongoose.connection.readyState;
  const mongoStatusMap = { 0: 'unhealthy', 1: 'healthy', 2: 'degraded', 3: 'degraded' };
  const mongoStateLabel = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

  // ── Process ──────────────────────────────────────────────────────────────────
  const memUsage = process.memoryUsage();
  const uptimeSec = Math.round(process.uptime());

  // ── Host OS ──────────────────────────────────────────────────────────────────
  const freeMemory = os.freemem();
  const totalMemory = os.totalmem();

  // ── Build response ────────────────────────────────────────────────────────────
  const services = {
    coreService: {
      name: 'Core Service',
      status: 'healthy',
      description: 'User Management · Profile Builder · Admin Panel',
      modules: ['userManagement', 'profileBuilder', 'adminPanel'],
      metrics: {
        totalUsers: userCount,
        totalProfiles: profileCount,
        uptime: uptimeSec,
        nodeVersion: process.version,
      },
    },
    aiService: {
      name: 'AI Service',
      ...aiPing,
      description: 'CV Parsing · NLP Extraction',
      modules: ['cvParsing'],
      url: aiServiceUrl,
    },
    mongodb: {
      name: 'MongoDB',
      status: mongoStatusMap[mongoState] || 'unknown',
      description: 'Primary database',
      readyState: mongoState,
      stateLabel: mongoStateLabel[mongoState] || 'unknown',
      metrics: {
        totalUsers: userCount,
        totalProfiles: profileCount,
      },
    },
  };

  const systemResources = {
    process: {
      uptime: uptimeSec,
      nodeVersion: process.version,
      pid: process.pid,
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        heapUsedPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
      },
    },
    host: {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpus: os.cpus().length,
      freeMemory,
      totalMemory,
      memoryUsedPercent: Math.round((1 - freeMemory / totalMemory) * 100),
    },
  };

  const allHealthy = Object.values(services).every((s) => s.status === 'healthy');

  return res.status(allHealthy ? 200 : 207).json({
    success: true,
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services,
    systemResources,
  });
};

// @route   GET /api/admin/system/status
// @desc    Operational status of all known modules
// @access  Admin
export const getSystemStatus = async (req, res) => {
  return res.json({
    success: true,
    status: 'operational',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    modules: {
      userManagement: 'active',
      cvParsing: 'active',
      profileBuilder: 'active',
      adminPanel: 'active',
      careerMatching: 'not_available',
      interviewPrep: 'not_available',
      learningPath: 'not_available',
      cvGeneration: 'not_available',
      jobBoard: 'not_available',
    },
  });
};

// @route   GET /api/admin/system/logs
// @desc    Paginated admin action audit logs
// @access  Admin
export const getAdminLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, action, adminId, resource, status } = req.query;

    const filter = {};
    if (action) filter.action = action;
    if (adminId) filter.adminId = adminId;
    if (resource) filter.resource = resource;
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      AdminLog.find(filter)
        .populate('adminId', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      AdminLog.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get admin logs error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch logs' });
  }
};
