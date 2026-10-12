// Gateway limits, sizes and timeouts — all env-driven with safe defaults.
// loadConfig() reads process.env when the app is created (restart the gateway
// after changing .env).

const positiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const minutes = (value, fallbackMinutes) => positiveInt(value, fallbackMinutes) * 60 * 1000;

export const loadConfig = (env = process.env) => ({
  rateLimitEnabled: env.RATE_LIMIT_ENABLED !== 'false',
  rateLimits: {
    global: {
      max: positiveInt(env.RATE_LIMIT_GLOBAL_MAX, 600),
      windowMs: minutes(env.RATE_LIMIT_GLOBAL_WINDOW_MINUTES, 15),
    },
    login: {
      max: positiveInt(env.RATE_LIMIT_LOGIN_MAX, 10),
      windowMs: minutes(env.RATE_LIMIT_LOGIN_WINDOW_MINUTES, 15),
    },
    register: {
      max: positiveInt(env.RATE_LIMIT_REGISTER_MAX, 10),
      windowMs: minutes(env.RATE_LIMIT_REGISTER_WINDOW_MINUTES, 60),
    },
    passwordReset: {
      max: positiveInt(env.RATE_LIMIT_PASSWORD_RESET_MAX, 5),
      windowMs: minutes(env.RATE_LIMIT_PASSWORD_RESET_WINDOW_MINUTES, 60),
    },
    cvUpload: {
      max: positiveInt(env.RATE_LIMIT_CV_UPLOAD_MAX, 20),
      windowMs: minutes(env.RATE_LIMIT_CV_UPLOAD_WINDOW_MINUTES, 60),
    },
  },
  maxBodyBytes: positiveInt(env.GATEWAY_MAX_BODY_BYTES, 1 * 1024 * 1024),
  maxUploadBytes: positiveInt(env.GATEWAY_MAX_UPLOAD_BYTES, 6 * 1024 * 1024),
  proxyTimeoutMs: positiveInt(env.GATEWAY_PROXY_TIMEOUT_MS, 30000),
  uploadTimeoutMs: positiveInt(env.GATEWAY_UPLOAD_TIMEOUT_MS, 60000),
  authServiceUrl: env.AUTH_SERVICE_URL || 'http://localhost:3000',
  cvServiceUrl: env.CV_SERVICE_URL || 'http://localhost:8000',
  // Used to report gateway errors to CoreServices (POST /internal/logs).
  internalApiKey: env.INTERNAL_API_KEY || '',
  spikeThreshold: positiveInt(env.RATE_LIMIT_SPIKE_THRESHOLD, 20),
  spikeWindowMs: minutes(env.RATE_LIMIT_SPIKE_WINDOW_MINUTES, 10),
});

export const CV_UPLOAD_PATH = '/api/cv/upload';

// Path without query string, e.g. "/api/cv/upload".
export const pathOf = (req) => (req.originalUrl || req.url || '').split('?')[0];
