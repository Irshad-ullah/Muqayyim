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
} from './apiErrors.js';

let sessionEvents;
let unavailableEvents;

const listen = () => {
  sessionEvents = [];
  unavailableEvents = [];
  const onEnded = (e) => sessionEvents.push(e.detail);
  const onUnavailable = (e) => unavailableEvents.push(e.detail);
  authEvents.addEventListener(SESSION_ENDED, onEnded);
  authEvents.addEventListener(SERVICE_UNAVAILABLE, onUnavailable);
  return () => {
    authEvents.removeEventListener(SESSION_ENDED, onEnded);
    authEvents.removeEventListener(SERVICE_UNAVAILABLE, onUnavailable);
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
