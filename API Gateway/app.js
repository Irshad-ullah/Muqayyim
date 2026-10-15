// Load .env before any module reads configuration.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createProxyMiddleware } from 'http-proxy-middleware';

import http from 'http';
import { loadConfig, CV_UPLOAD_PATH, isTaxonomyUpload, pathOf } from './config.js';
import { requestId } from './middleware/requestId.js';
import { createSizeLimit, limitFor, refuseAfterDiscard } from './middleware/sizeLimit.js';
import { createRateLimiters, createTaxonomyPublishLimiter } from './middleware/rateLimits.js';
import { createErrorReporter } from './services/errorReporter.js';
import { createSpikeDetector } from './services/rateLimitSpike.js';
import { createErrorHandler } from './middleware/errorHandler.js';

// The gateway routes, limits and protects traffic. It does NOT verify JWTs:
// each service verifies tokens and the user's live state itself.
//
// createApp() reads configuration from the environment at call time, so tests
// can build apps with different limits; server.js uses the default instance.
export function createApp(config = loadConfig(), { errorReporter } = {}) {
  const app = express();

  // Gateway errors go to CoreServices' error log (batched, fire-and-forget).
  const reporter =
    errorReporter ||
    createErrorReporter({ coreUrl: config.authServiceUrl, internalKey: config.internalApiKey });
  app.locals.errorReporter = reporter;

  const spikes = createSpikeDetector({
    threshold: config.spikeThreshold,
    windowMs: config.spikeWindowMs,
    onSpike: ({ ip, count, windowMs, limit, requestId }) =>
      reporter.report({
        level: 'warning',
        module: 'rate-limit',
        errorType: 'RATE_LIMIT_SPIKE',
        message: `IP ${ip} hit rate limits ${count} times in ${Math.round(windowMs / 60000)} minutes (latest: ${limit})`,
        requestId,
      }),
  });
  const limiters = createRateLimiters(config, {
    onLimitHit: (name, req) => spikes.record(req.ip, { limit: name, requestId: req.requestId }),
  });
  const taxonomyPublishLimiter = createTaxonomyPublishLimiter(config, {
    onLimitHit: (name, req) => spikes.record(req.ip, { limit: name, requestId: req.requestId }),
  });
  if (config.rateLimitEnabled && !config.jwtSecret) {
    console.warn('[Gateway] JWT_SECRET not set: the taxonomy publish/restore limit is keyed by client IP, not by user.');
  }

  // Trust X-Forwarded-For only from known proxies so req.ip is the real client
  // (used for rate limiting and logs; behind Railway/Render's proxy).
  //   unset → 'loopback' | true/false | hop count (e.g. 1) | subnet list string
  const parseTrustProxy = (value) => {
    if (value === undefined || value === '') return 'loopback';
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^\d+$/.test(value)) return Number(value);
    return value;
  };
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
  app.disable('x-powered-by');

  const AUTH_SERVICE_URL = config.authServiceUrl;
  const CV_SERVICE_URL   = config.cvServiceUrl;

  // ─── Request ID (first, so every response and log line has one) ──────────────
  app.use(requestId);

  // ─── Security headers ────────────────────────────────────────────────────────
  // JSON-only API: no HTML is served, so a Content-Security-Policy adds nothing.
  app.use(helmet({ contentSecurityPolicy: false }));

  // ─── CORS ─────────────────────────────────────────────────────────────────────
  // Only the web frontend talks to the gateway; services are called server-to-server.
  app.use(
    cors({
      origin: [
        process.env.FRONTEND_URL || process.env.MODULE1_FRONTEND_URL || 'http://localhost:5174',
        'http://127.0.0.1:5174',
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit', 'RateLimit-Policy'],
    })
  );

  // Handle OPTIONS preflight globally so the proxy (and the limiters) never see it
  app.options('*', cors());

  // ─── Logging ──────────────────────────────────────────────────────────────────
  morgan.token('rid', (req) => req.requestId);
  app.use(
    morgan(':method :url :status :res[content-length] - :response-time ms rid=:rid', {
      skip: (req) => req.url === '/health',
    })
  );

  // ─── Block service-to-service routes ─────────────────────────────────────────
  // /internal/* is only for direct calls between services (X-Internal-Key) and
  // must never be reachable from the browser through the gateway.
  app.use('/internal', (_req, res) => {
    res.status(404).json({ success: false, message: 'Route not found on gateway' });
  });

  // ─── Rate limits (per client IP) ──────────────────────────────────────────────
  app.use('/api', limiters.global);
  app.post('/api/auth/login', limiters.login);
  app.post('/api/auth/register', limiters.register);
  app.post('/api/auth/forgot-password', limiters.passwordReset);
  app.post('/api/auth/reset-password/:token', limiters.passwordReset);
  app.post(CV_UPLOAD_PATH, limiters.cvUpload);
  // Taxonomy publish and restore: 5 per 15 minutes (shared), per user id or IP.
  app.post('/api/admin/taxonomy/jobs/:id/publish', taxonomyPublishLimiter);
  app.post('/api/admin/taxonomy/snapshots/:id/restore', taxonomyPublishLimiter);

  // ─── Request size (Content-Length; body is never parsed here) ─────────────────
  app.use('/api', createSizeLimit(config));

  // ─── Proxy helpers ────────────────────────────────────────────────────────────
  // Timeout is the upstream inactivity limit: 5 min for the taxonomy dataset upload,
  // 60 s for CV uploads, 30 s otherwise (taxonomy publish/restore answer 202 at once).
  const timeoutFor = (req) => {
    if (isTaxonomyUpload(req)) return config.taxonomyUploadTimeoutMs;
    return pathOf(req) === CV_UPLOAD_PATH ? config.uploadTimeoutMs : config.proxyTimeoutMs;
  };

  function onProxyReq(proxyReq, req, res) {
    proxyReq.setTimeout(timeoutFor(req), () => {
      req.gatewayTimedOut = true;
      proxyReq.destroy(new Error('Upstream timeout'));
    });
    // A taxonomy upload without Content-Length (chunked): count the bytes as they
    // stream through and stop at the limit. Attached here, in the same tick as the
    // proxy's pipe, so no chunk is missed or consumed.
    if (isTaxonomyUpload(req) && req.get('content-length') === undefined) {
      const { max, body } = limitFor(req, config);
      let seen = 0;
      req.on('data', (chunk) => {
        seen += chunk.length;
        if (seen <= max || req.gatewayTooLarge) return;
        req.gatewayTooLarge = true;
        req.unpipe(proxyReq);
        proxyReq.destroy(); // Core sees an aborted upload: no job is created
        refuseAfterDiscard(req, res, body);
      });
    }
  }

  // Upstream failures become clean JSON (never an HTML page or stack trace).
  function onError(name) {
    return (err, req, res) => {
      if (req.gatewayTooLarge) return; // the upload was stopped at the limit; the 413 is on its way
      if (res.headersSent) {
        res.end();
        return;
      }
      const timedOut = req.gatewayTimedOut === true;
      console.error(
        `[Gateway] ${name} ${timedOut ? 'timed out' : 'unreachable'} (${err.code || err.message}) rid=${req.requestId}`,
      );
      reporter.report({
        level: 'error',
        module: 'proxy',
        errorType: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
        message: `${name} ${timedOut ? 'did not respond in time' : 'is unreachable'} (${err.code || err.message})`,
        requestId: req.requestId,
        method: req.method,
        path: pathOf(req),
        statusCode: timedOut ? 504 : 502,
      });
      res.status(timedOut ? 504 : 502).json({
        success: false,
        code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
        message: timedOut
          ? `${name} did not respond in time. Please try again.`
          : `${name} is temporarily unavailable. Please try again.`,
      });
    };
  }

  // The gateway's own CORS and security headers are the only ones the browser
  // sees: strip the downstream service's CORS and X-Powered-By headers.
  function onProxyRes(proxyRes) {
    delete proxyRes.headers['access-control-allow-origin'];
    delete proxyRes.headers['access-control-allow-credentials'];
    delete proxyRes.headers['access-control-allow-methods'];
    delete proxyRes.headers['access-control-allow-headers'];
    delete proxyRes.headers['x-powered-by'];
  }

  const proxyTo = (target, name) =>
    createProxyMiddleware({
      target,
      changeOrigin: true,
      xfwd: true, // pass the client IP downstream (X-Forwarded-For)
      onProxyReq,
      onProxyRes,
      onError: onError(name),
      logLevel: 'silent',
    });

  const coreProxy = proxyTo(AUTH_SERVICE_URL, 'Core Service');
  const aiProxy = proxyTo(CV_SERVICE_URL, 'CV Service');

  // ─── Routes ───────────────────────────────────────────────────────────────────
  app.use('/api/auth', coreProxy);            // Module 1 — User Management
  app.use('/api/profile', coreProxy);         // Module 3 — Profile Builder
  app.use('/api/generated-cvs', coreProxy);   // Module 4 — CV Generator
  app.use('/api/cv', aiProxy);                // Module 2 — CV Parsing (AIServices)
  app.use('/api/embeddings', aiProxy);        // Module 2 FE-4/FE-5 — skill embeddings (AIServices)
  app.use('/api/admin', coreProxy);           // Module 10 — Admin Panel

  // ─── Gateway health check ─────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      gateway: 'MUQAYYIM API Gateway',
      version: '1.0.0',
      routes: {
        '/api/auth/*':    AUTH_SERVICE_URL,
        '/api/profile/*': AUTH_SERVICE_URL,
        '/api/generated-cvs/*': AUTH_SERVICE_URL,
        '/api/cv/*':      CV_SERVICE_URL,
        '/api/embeddings/*': CV_SERVICE_URL,
        '/api/admin/*':   AUTH_SERVICE_URL,
      },
    });
  });

  // ─── Root ─────────────────────────────────────────────────────────────────────
  app.get('/', (_req, res) => {
    res.json({
      message: 'MUQAYYIM API Gateway',
      version: '1.0.0',
      endpoints: ['/api/auth', '/api/profile', '/api/generated-cvs', '/api/cv', '/api/embeddings', '/api/admin', '/health'],
    });
  });

  // ─── 404 for unmatched routes ─────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ success: false, message: 'Route not found on gateway' });
  });

  // ─── Unhandled gateway errors → error log + clean JSON 500 ────────────────────
  app.use(createErrorHandler(reporter));

  return app;
}

const config = loadConfig();
const app = createApp(config);
export const AUTH_SERVICE_URL = config.authServiceUrl;
export const CV_SERVICE_URL = config.cvServiceUrl;
export default app;


// An HTTP server for the app. Clients such as curl send "Expect: 100-continue" for
// large bodies; Node would answer "100 Continue" automatically and the client would
// then send the whole body before seeing the 413. Here an oversized request gets
// its 413 instead of "100 Continue", so the body is never sent.
export function createServer(appInstance = app, config = loadConfig()) {
  const server = http.createServer(appInstance);
  server.on('checkContinue', (req, res) => {
    const length = Number.parseInt(req.headers['content-length'], 10);
    req.originalUrl = req.url;
    const { max, body } = limitFor(req, config);
    if (Number.isFinite(length) && length > max) {
      const text = JSON.stringify(body);
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text),
        Connection: 'close' });
      res.end(text);
      return;
    }
    res.writeContinue();
    appInstance(req, res);
  });
  // The whole request (a 100 MB upload) may take up to the upload timeout to arrive.
  server.requestTimeout = config.taxonomyUploadTimeoutMs + 60 * 1000;
  return server;
}
