// Central handling of auth-related API errors for every client (axios
// instances and fetch wrappers). Framework-free so it can be unit-tested with
// `node --test`; AuthContext listens to `authEvents` and does the UI work.
//
// - 401 TOKEN_REVOKED / TOKEN_EXPIRED / USER_NOT_FOUND / TOKEN_INVALID and
//   403 ACCOUNT_DEACTIVATED → "session ended" (fired once, even if several
//   requests fail together) → AuthContext clears auth state, guards redirect
//   to /login, and the server's message is shown.
// - 503 AUTH_UNAVAILABLE → "service unavailable" notice; the user stays signed in.
// - Anything else (e.g. login's plain 401, change-password's 400) is ignored
//   here and left to the calling page.

export const SESSION_ENDED = 'session-ended';
export const SERVICE_UNAVAILABLE = 'service-unavailable';

const SESSION_ENDING_401 = new Set(['TOKEN_REVOKED', 'TOKEN_EXPIRED', 'USER_NOT_FOUND', 'TOKEN_INVALID']);
const DEFAULT_MESSAGES = {
  TOKEN_REVOKED: 'Your session has ended. Please log in again.',
  TOKEN_EXPIRED: 'Your session has expired. Please log in again.',
  USER_NOT_FOUND: 'Your account no longer exists.',
  TOKEN_INVALID: 'Your session is invalid. Please log in again.',
  ACCOUNT_DEACTIVATED: 'Your account has been suspended. Contact support.',
};
export const SERVICE_UNAVAILABLE_MESSAGE = 'Service temporarily unavailable, try again';
const UNAVAILABLE_THROTTLE_MS = 5000;

export const authEvents = new EventTarget();

let sessionEnded = false;
let lastUnavailableAt = 0;

// Call when a new session starts (login/register) so a later expiry fires again.
export const resetAuthErrorState = () => {
  sessionEnded = false;
  lastUnavailableAt = 0;
};

const emit = (type, detail) => authEvents.dispatchEvent(new CustomEvent(type, { detail }));

// Returns 'session-ended' | 'service-unavailable' | null.
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

  if (status === 503 && code === 'AUTH_UNAVAILABLE') {
    const now = Date.now();
    if (now - lastUnavailableAt > UNAVAILABLE_THROTTLE_MS) {
      lastUnavailableAt = now;
      emit(SERVICE_UNAVAILABLE, { code, message: SERVICE_UNAVAILABLE_MESSAGE });
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
