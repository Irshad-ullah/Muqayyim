import { rateLimit } from 'express-rate-limit';
import { pathOf } from '../config.js';
import { verifiedUserId } from './jwtIdentity.js';

// Per-IP rate limits (SEC-3). Keyed by req.ip, which honours TRUST_PROXY, so
// behind Railway/Render the real client IP is used.
//
// NOTE: the default in-memory store is per gateway instance. Running several
// gateway instances would need a shared store (e.g. rate-limit-redis) so the
// limits apply across instances. Not needed for a single instance.

const passThrough = (_req, _res, next) => next();

const logLimitHit = (name, req, onLimitHit) => {
  onLimitHit?.(name, req);
  console.warn(
    `[RateLimit] ${JSON.stringify({
      limit: name,
      route: `${req.method} ${pathOf(req)}`,
      ip: req.ip,
      requestId: req.requestId,
    })}`,
  );
};

const createLimiter = (enabled, name, { max, windowMs }, extra = {}, onLimitHit = undefined) => {
  if (!enabled) return passThrough;
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7', // RateLimit + RateLimit-Policy headers
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS' || pathOf(req) === '/health',
    handler: (req, res) => {
      const resetAt = req.rateLimit?.resetTime?.getTime?.() ?? Date.now() + windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      const mins = Math.max(1, Math.ceil(retryAfterSeconds / 60));
      logLimitHit(name, req, onLimitHit);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        message: `Too many requests. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
        retryAfterSeconds,
      });
    },
    ...extra,
  });
};

// One set of limiters (each with its own in-memory counter) per app instance.
// `onLimitHit(name, req)` is called for every blocked request (spike detection).
export const createRateLimiters = ({ rateLimitEnabled: enabled, rateLimits }, { onLimitHit } = {}) => ({
  global: createLimiter(enabled, 'global', rateLimits.global, {}, onLimitHit),
  // Counts only failed logins (status >= 400): express-rate-limit decides
  // success from the final response status, which the proxy sets from the
  // upstream response, so successful logins never use up the budget.
  login: createLimiter(enabled, 'login', rateLimits.login, { skipSuccessfulRequests: true }, onLimitHit),
  register: createLimiter(enabled, 'register', rateLimits.register, {}, onLimitHit),
  // One shared budget for forgot-password and reset-password.
  passwordReset: createLimiter(enabled, 'passwordReset', rateLimits.passwordReset, {}, onLimitHit),
  cvUpload: createLimiter(enabled, 'cvUpload', rateLimits.cvUpload, {}, onLimitHit),
});

// Taxonomy publish + restore (09c): one shared budget per user id when the token is
// valid (needs JWT_SECRET in the gateway), otherwise per client IP.
export const createTaxonomyPublishLimiter = ({ rateLimitEnabled: enabled, rateLimits, jwtSecret }, { onLimitHit } = {}) =>
  createLimiter(enabled, 'taxonomyPublish', rateLimits.taxonomyPublish, {
    keyGenerator: (req) => {
      const userId = verifiedUserId(req, jwtSecret);
      return userId ? `user:${userId}` : `ip:${req.ip}`;
    },
  }, onLimitHit);
