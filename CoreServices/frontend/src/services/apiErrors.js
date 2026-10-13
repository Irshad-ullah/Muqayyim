// Central handling of API errors (auth, rate limits, size limits, gateway
// failures) for every client (axios instances and fetch wrappers). Framework-free so it can be unit-tested with
// `node --test`; AuthContext listens to `authEvents` and does the UI work.
//
// - 401 TOKEN_REVOKED / TOKEN_EXPIRED / USER_NOT_FOUND / TOKEN_INVALID and
//   403 ACCOUNT_DEACTIVATED → "session ended" (fired once, even if several
//   requests fail together) → AuthContext clears auth state, guards redirect
//   to /login, and the server's message is shown.
// - 503 AUTH_UNAVAILABLE, 502 UPSTREAM_UNAVAILABLE, 504 UPSTREAM_TIMEOUT →
//   "service unavailable" notice; the user stays signed in.
// - 429 RATE_LIMITED → notice with the server's message (no logout).
// - 413 PAYLOAD_TOO_LARGE → notice with a clear "file too large" message.
// - Anything else (e.g. login's plain 401, change-password's 400) is ignored
//   here and left to the calling page.

export const SESSION_ENDED = 'session-ended';
export const SERVICE_UNAVAILABLE = 'service-unavailable';
export const NOTICE = 'notice';
export const RATE_LIMITED = 'rate-limited';
export const PAYLOAD_TOO_LARGE = 'payload-too-large';

const SESSION_ENDING_401 = new Set(['TOKEN_REVOKED', 'TOKEN_EXPIRED', 'USER_NOT_FOUND', 'TOKEN_INVALID']);
const DEFAULT_MESSAGES = {
  TOKEN_REVOKED: 'Your session has ended. Please log in again.',
  TOKEN_EXPIRED: 'Your session has expired. Please log in again.',
  USER_NOT_FOUND: 'Your account no longer exists.',
  TOKEN_INVALID: 'Your session is invalid. Please log in again.',
  ACCOUNT_DEACTIVATED: 'Your account has been suspended. Contact support.',
};
export const SERVICE_UNAVAILABLE_MESSAGE = 'Service temporarily unavailable, try again';
export const RATE_LIMITED_MESSAGE = 'Too many requests. Please try again later.';
export const PAYLOAD_TOO_LARGE_MESSAGE = 'The file is too large. CV files must be 5 MB or smaller.';
const UNAVAILABLE_THROTTLE_MS = 5000;
const NOTICE_THROTTLE_MS = 3000;

export const authEvents = new EventTarget();

let sessionEnded = false;
let lastUnavailableAt = 0;
const lastNoticeAt = {};

// Call when a new session starts (login/register) so a later expiry fires again.
export const resetAuthErrorState = () => {
  sessionEnded = false;
  lastUnavailableAt = 0;
  for (const key of Object.keys(lastNoticeAt)) delete lastNoticeAt[key];
};

const emit = (type, detail) => authEvents.dispatchEvent(new CustomEvent(type, { detail }));

// One notice per code within NOTICE_THROTTLE_MS (parallel requests → one toast).
const notice = (code, message) => {
  const now = Date.now();
  if (now - (lastNoticeAt[code] || 0) <= NOTICE_THROTTLE_MS) return;
  lastNoticeAt[code] = now;
  emit(NOTICE, { code, message });
};

export const PAGE_HANDLED_503 = new Set(['EMBEDDINGS_PENDING', 'MODEL_LOADING']);

// Returns 'session-ended' | 'service-unavailable' | 'rate-limited' |
// 'payload-too-large' | null.
export const handleApiError = (status, body) => {
  const code = body?.code;
  const endsSession =
    (status === 401 && SESSION_ENDING_401.has(code)) || (status === 403 && code === 'ACCOUNT_DEACTIVATED');

  if (endsSession) {
    if (!sessionEnded) {
      sessionEnded = true;
      emit(SESSION_ENDED, { code, message: body?.message || DEFAULT_MESSAGES[code] });
    }
    return SESSION_ENDED;
  }

  // Feature-level 503s (skill embeddings still being created, model loading)
  // are shown by the page itself: never a logout or a global notice.
  if (status === 503 && PAGE_HANDLED_503.has(code)) return null;

  if (status === 429) {
    notice('RATE_LIMITED', body?.message || RATE_LIMITED_MESSAGE);
    return RATE_LIMITED;
  }

  if (status === 413) {
    notice('PAYLOAD_TOO_LARGE', body?.message || PAYLOAD_TOO_LARGE_MESSAGE);
    return PAYLOAD_TOO_LARGE;
  }

  if (status === 502 || status === 504 || (status === 503 && code === 'AUTH_UNAVAILABLE')) {
    const now = Date.now();
    if (now - lastUnavailableAt > UNAVAILABLE_THROTTLE_MS) {
      lastUnavailableAt = now;
      emit(SERVICE_UNAVAILABLE, { code: code || `HTTP_${status}`, message: SERVICE_UNAVAILABLE_MESSAGE });
    }
    return SERVICE_UNAVAILABLE;
  }

  return null;
};

// Axios: inspect failed responses, then re-throw so callers still see the error.
export const installAuthInterceptor = (axiosInstance) =>
  axiosInstance.interceptors.response.use(
    (response) => response,
    (error) => {
      handleApiError(error?.response?.status, error?.response?.data);
      return Promise.reject(error);
    },
  );

// fetch(): same handling; returns the Response untouched for the caller.
export const apiFetch = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .catch(() => ({}));
    handleApiError(response.status, body);
  }
  return response;
};

// True when the central handler already informed the user about this error
// (pages can then show inline errors without a duplicate toast).
export const isHandledGlobally = (error) => {
  const status = error?.response?.status ?? error?.status;
  const code = error?.response?.data?.code ?? error?.code;
  return status === 413 || status === 429 || status === 502 || status === 504 || (status === 503 && code === 'AUTH_UNAVAILABLE');
};

// Error for fetch() callers that keeps the HTTP status and server code.
export const apiError = (response, body, fallback) => {
  const error = new Error(body?.message || body?.detail || fallback);
  error.status = response.status;
  error.code = body?.code;
  // VALIDATION_ERROR: [{ field, message }]; PROFILE_INCOMPLETE: ['name', ...]
  if (Array.isArray(body?.errors)) error.errors = body.errors;
  if (Array.isArray(body?.missing)) error.missing = body.missing;
  return error;
};
