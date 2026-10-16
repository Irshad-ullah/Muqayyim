import { jest } from '@jest/globals';
import request from 'supertest';
import { startStub, useTargets } from './stub.js';

// These tests build a gateway app per case and send many requests through supertest; on a
// loaded machine that can exceed Jest's 5 s default (seen once on 2026-10-16), so allow 30 s.
jest.setTimeout(30_000);

// Env-driven configuration: limits are read when app.js is imported, so each
// scenario imports a fresh copy of the app with different settings.
let stub;

beforeAll(async () => {
  stub = await startStub();
  useTargets(stub.url);
});

afterAll(() => stub.close());

const freshApp = async (env) => {
  const { createApp } = await import('../app.js');
  const { loadConfig } = await import('../config.js');
  return createApp(loadConfig({ ...process.env, ...env }));
};

test('RATE_LIMIT_ENABLED=false disables every limiter', async () => {
  const app = await freshApp({ RATE_LIMIT_ENABLED: 'false', RATE_LIMIT_GLOBAL_MAX: '3' });
  for (let i = 0; i < 25; i++) {
    const res = await request(app).post('/api/auth/login').set('x-stub-status', '401').send({});
    expect(res.status).toBe(401);
    expect(res.headers.ratelimit).toBeUndefined();
  }
});

test('global limit applies to all /api routes and is configurable', async () => {
  const app = await freshApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_GLOBAL_MAX: '3' });
  const ip = '198.51.100.7';
  for (let i = 0; i < 3; i++) expect((await request(app).get('/api/profile').set('X-Forwarded-For', ip)).status).toBe(200);
  const res = await request(app).get('/api/generated-cvs').set('X-Forwarded-For', ip);
  expect(res.status).toBe(429);
  expect(res.body.code).toBe('RATE_LIMITED');
  expect((await request(app).get('/health').set('X-Forwarded-For', ip)).status).toBe(200);
});

test('invalid env values fall back to the defaults', async () => {
  const app = await freshApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_LOGIN_MAX: 'not-a-number', RATE_LIMIT_GLOBAL_MAX: '-5' });
  const ip = '198.51.100.9';
  for (let i = 0; i < 10; i++) {
    expect((await request(app).post('/api/auth/login').set('X-Forwarded-For', ip).set('x-stub-status', '401')).status).toBe(401);
  }
  expect((await request(app).post('/api/auth/login').set('X-Forwarded-For', ip).set('x-stub-status', '401')).status).toBe(429);
});
