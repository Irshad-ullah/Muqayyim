import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createProxyMiddleware } from 'http-proxy-middleware';

dotenv.config();

const app = express();

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3000';
const CV_SERVICE_URL   = process.env.CV_SERVICE_URL   || 'http://localhost:8000';
const PORT             = process.env.PORT              || 8080;

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allow both frontends to talk to the gateway.
// The gateway proxies server-to-server, so only frontend origins need to be listed.
app.use(
  cors({
    origin: [
      process.env.MODULE1_FRONTEND_URL || 'http://localhost:5174',
      process.env.MODULE2_FRONTEND_URL || 'http://localhost:5173',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:5173',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Handle OPTIONS preflight globally so the proxy never sees it
app.options('*', cors());

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(
  morgan(':method :url :status :res[content-length] - :response-time ms', {
    skip: (req) => req.url === '/health',
  })
);

// ─── Proxy helpers ────────────────────────────────────────────────────────────
function onError(err, req, res, target) {
  const name = target === AUTH_SERVICE_URL ? 'Auth Service' : 'CV Service';
  console.error(`[Gateway] Error reaching ${name}:`, err.message);
  res.status(502).json({
    success: false,
    message: `${name} is unavailable. Make sure it is running.`,
  });
}

// Strip the CORS headers the downstream service might add so the gateway's
// own CORS headers (already written by the cors() middleware above) are the
// only ones the browser sees.
function stripDownstreamCors(proxyRes) {
  delete proxyRes.headers['access-control-allow-origin'];
  delete proxyRes.headers['access-control-allow-credentials'];
  delete proxyRes.headers['access-control-allow-methods'];
  delete proxyRes.headers['access-control-allow-headers'];
}

// ─── Route: /api/auth/* → Module 1 (User Management Service) ──────────────────
app.use(
  '/api/auth',
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    onError: (err, req, res) => onError(err, req, res, AUTH_SERVICE_URL),
    onProxyRes: stripDownstreamCors,
    logLevel: 'silent',
  })
);

// ─── Route: /api/cv/* → Module 2 (CV Parsing Service) ────────────────────────
app.use(
  '/api/cv',
  createProxyMiddleware({
    target: CV_SERVICE_URL,
    changeOrigin: true,
    onError: (err, req, res) => onError(err, req, res, CV_SERVICE_URL),
    onProxyRes: stripDownstreamCors,
    logLevel: 'silent',
  })
);

// ─── Gateway health check ─────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    gateway: 'MUQAYYIM API Gateway',
    version: '1.0.0',
    routes: {
      '/api/auth/*': AUTH_SERVICE_URL,
      '/api/cv/*':   CV_SERVICE_URL,
    },
  });
});

// ─── Root ─────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    message: 'MUQAYYIM API Gateway',
    version: '1.0.0',
    endpoints: ['/api/auth', '/api/cv', '/health'],
  });
});

// ─── 404 for unmatched routes ─────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found on gateway' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('🌐  MUQAYYIM API Gateway');
  console.log(`    Listening on   → http://localhost:${PORT}`);
  console.log(`    /api/auth/*    → ${AUTH_SERVICE_URL}  (Module 1)`);
  console.log(`    /api/cv/*      → ${CV_SERVICE_URL}  (Module 2)`);
  console.log('');
});
