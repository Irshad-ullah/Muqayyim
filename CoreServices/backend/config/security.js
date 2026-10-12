// Login-lockout settings (SRS FR1.2, SEC-3). Env-driven with safe defaults.
const positiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const MAX_LOGIN_ATTEMPTS = positiveInt(process.env.MAX_LOGIN_ATTEMPTS, 5);
export const LOCK_DURATION_MINUTES = positiveInt(process.env.LOCK_DURATION_MINUTES, 15);
export const LOCK_DURATION_MS = LOCK_DURATION_MINUTES * 60 * 1000;
