// Run with: npm test  (node --test, no extra dependencies)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  authEvents,
  handleApiError,
  resetAuthErrorState,
  installAuthInterceptor,
  apiFetch,
  SESSION_ENDED,
  SERVICE_UNAVAILABLE,
  NOTICE,
  RATE_LIMITED,
  PAYLOAD_TOO_LARGE,
  isHandledGlobally,
  apiError,
} from './apiErrors.js';

let sessionEvents;
let unavailableEvents;
let noticeEvents;

const listen = () => {
  sessionEvents = [];
  unavailableEvents = [];
  noticeEvents = [];
  const onEnded = (e) => sessionEvents.push(e.detail);
  const onUnavailable = (e) => unavailableEvents.push(e.detail);
  const onNotice = (e) => noticeEvents.push(e.detail);
  authEvents.addEventListener(SESSION_ENDED, onEnded);
  authEvents.addEventListener(SERVICE_UNAVAILABLE, onUnavailable);
  authEvents.addEventListener(NOTICE, onNotice);
  return () => {
    authEvents.removeEventListener(SESSION_ENDED, onEnded);
    authEvents.removeEventListener(SERVICE_UNAVAILABLE, onUnavailable);
    authEvents.removeEventListener(NOTICE, onNotice);
  };
};

let stop = () => {};
beforeEach(() => {
  stop();
  resetAuthErrorState();
  stop = listen();
});

// A minimal axios stand-in: lets the test run requests through the real interceptor.
const fakeAxios = () => {
  let onError;
  return {
    interceptors: { response: { use: (_ok, err) => { onError = err; } } },
    fail: (status, data) => onError({ response: { status, data } }).catch(() => {}),
  };
};

test('TOKEN_REVOKED fires session-ended once even when 3 requests fail together', async () => {
  const api = fakeAxios();
  installAuthInterceptor(api);
  const body = { success: false, code: 'TOKEN_REVOKED', message: 'Your session has ended. Please log in again.' };
  await Promise.all([api.fail(401, body), api.fail(401, body), api.fail(401, body)]);
  assert.equal(sessionEvents.length, 1);
  assert.deepEqual(sessionEvents[0], { code: 'TOKEN_REVOKED', message: body.message });
});

test('ACCOUNT_DEACTIVATED (403) fires session-ended once with the suspension message', async () => {
  const body = { code: 'ACCOUNT_DEACTIVATED', message: 'Your account has been suspended. Contact support.' };
  const results = [handleApiError(403, body), handleApiError(403, body), handleApiError(403, body)];
  assert.deepEqual(results, [SESSION_ENDED, SESSION_ENDED, SESSION_ENDED]);
  assert.equal(sessionEvents.length, 1);
  assert.equal(sessionEvents[0].message, body.message);
});

test('TOKEN_EXPIRED, USER_NOT_FOUND and TOKEN_INVALID also end the session', () => {
  for (const code of ['TOKEN_EXPIRED', 'USER_NOT_FOUND', 'TOKEN_INVALID']) {
    resetAuthErrorState();
    assert.equal(handleApiError(401, { code }), SESSION_ENDED);
  }
  assert.equal(sessionEvents.length, 3);
});

test("login's plain 401 (no code) does not fire session-ended", () => {
  assert.equal(handleApiError(401, { success: false, message: 'Invalid email or password' }), null);
  assert.equal(sessionEvents.length, 0);
});

test("change-password's 400 does not fire session-ended", () => {
  const body = { success: false, field: 'currentPassword', message: 'Current password is incorrect' };
  assert.equal(handleApiError(400, body), null);
  assert.equal(sessionEvents.length, 0);
});

test('a 403 without ACCOUNT_DEACTIVATED (e.g. not an admin) does not end the session', () => {
  assert.equal(handleApiError(403, { message: 'Access denied. Admin privileges required.' }), null);
  assert.equal(sessionEvents.length, 0);
});

test('503 AUTH_UNAVAILABLE shows a notice but does not log out', () => {
  assert.equal(handleApiError(503, { code: 'AUTH_UNAVAILABLE' }), SERVICE_UNAVAILABLE);
  handleApiError(503, { code: 'AUTH_UNAVAILABLE' }); // throttled duplicate
  assert.equal(sessionEvents.length, 0);
  assert.equal(unavailableEvents.length, 1);
  assert.equal(unavailableEvents[0].message, 'Service temporarily unavailable, try again');
});

test('after a new login the next expiry fires again', () => {
  handleApiError(401, { code: 'TOKEN_EXPIRED' });
  resetAuthErrorState();
  handleApiError(401, { code: 'TOKEN_EXPIRED' });
  assert.equal(sessionEvents.length, 2);
});

test('apiFetch applies the same handling to fetch() responses', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ code: 'ACCOUNT_DEACTIVATED', message: 'Suspended' }), { status: 403 });
  try {
    const res = await apiFetch('http://example.test/api/profile');
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { code: 'ACCOUNT_DEACTIVATED', message: 'Suspended' }); // body still readable
    assert.equal(sessionEvents.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('429 RATE_LIMITED shows the server message once and does not log out', async () => {
  const api = fakeAxios();
  installAuthInterceptor(api);
  const body = { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please try again in 14 minutes.', retryAfterSeconds: 840 };
  await Promise.all([api.fail(429, body), api.fail(429, body), api.fail(429, body)]);
  assert.equal(handleApiError(429, body), RATE_LIMITED);
  assert.equal(sessionEvents.length, 0);
  assert.equal(noticeEvents.length, 1);
  assert.deepEqual(noticeEvents[0], { code: 'RATE_LIMITED', message: body.message });
});

test('413 PAYLOAD_TOO_LARGE on CV upload shows a clear message, no logout', () => {
  assert.equal(
    handleApiError(413, { code: 'PAYLOAD_TOO_LARGE', message: 'The file is too large. CV files must be 5 MB or smaller.' }),
    PAYLOAD_TOO_LARGE,
  );
  assert.equal(sessionEvents.length, 0);
  assert.equal(noticeEvents[0].message, 'The file is too large. CV files must be 5 MB or smaller.');

  resetAuthErrorState();
  handleApiError(413, {}); // e.g. a 413 from another proxy with no JSON body
  assert.match(noticeEvents.at(-1).message, /too large/i);
});

test('502 UPSTREAM_UNAVAILABLE and 504 UPSTREAM_TIMEOUT show "service unavailable" without logging out', () => {
  assert.equal(handleApiError(502, { code: 'UPSTREAM_UNAVAILABLE' }), SERVICE_UNAVAILABLE);
  resetAuthErrorState();
  assert.equal(handleApiError(504, { code: 'UPSTREAM_TIMEOUT' }), SERVICE_UNAVAILABLE);
  assert.equal(sessionEvents.length, 0);
  assert.equal(unavailableEvents.length, 2);
  assert.ok(unavailableEvents.every((e) => e.message === 'Service temporarily unavailable, try again'));
});

test('isHandledGlobally lets pages skip duplicate toasts', () => {
  assert.equal(isHandledGlobally({ response: { status: 429, data: { code: 'RATE_LIMITED' } } }), true);
  assert.equal(isHandledGlobally({ status: 413 }), true);
  assert.equal(isHandledGlobally({ response: { status: 504 } }), true);
  assert.equal(isHandledGlobally({ response: { status: 503, data: { code: 'AUTH_UNAVAILABLE' } } }), true);
  assert.equal(isHandledGlobally({ response: { status: 400 } }), false);
  assert.equal(isHandledGlobally({ response: { status: 401, data: {} } }), false);
});

test('apiError keeps status and code for fetch() callers', () => {
  const err = apiError({ status: 413 }, { code: 'PAYLOAD_TOO_LARGE', message: 'Too big' }, 'fallback');
  assert.equal(err.message, 'Too big');
  assert.equal(err.status, 413);
  assert.equal(err.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(apiError({ status: 500 }, {}, 'Failed to upload CV').message, 'Failed to upload CV');
});

test('skill-embedding 503s (EMBEDDINGS_PENDING, MODEL_LOADING) never log out or raise a global notice', () => {
  for (const code of ['EMBEDDINGS_PENDING', 'MODEL_LOADING']) {
    assert.equal(handleApiError(503, { code }), null);
  }
  assert.deepEqual(sessionEvents, []);
  assert.deepEqual(unavailableEvents, []);
  assert.deepEqual(noticeEvents, []);
});
