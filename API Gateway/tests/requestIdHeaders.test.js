import request from 'supertest';
import { startStub, useTargets } from './stub.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let stub;
let app;

beforeAll(async () => {
  stub = await startStub();
  useTargets(stub.url);
  process.env.RATE_LIMIT_ENABLED = 'false';
  ({ default: app } = await import('../app.js'));
});

afterAll(() => stub.close());

const lastHit = () => stub.hits.at(-1);

describe('X-Request-Id', () => {
  test('generated (UUID v4) when absent, set on the response and received by the target', async () => {
    const res = await request(app).get('/api/profile');
    const id = res.headers['x-request-id'];
    expect(id).toMatch(UUID_V4);
    expect(lastHit().headers['x-request-id']).toBe(id);
  });

  test('preserved when the incoming id is valid', async () => {
    const res = await request(app).get('/api/profile').set('X-Request-Id', 'client-trace-0001-abc');
    expect(res.headers['x-request-id']).toBe('client-trace-0001-abc');
    expect(lastHit().headers['x-request-id']).toBe('client-trace-0001-abc');
  });

  test.each([
    ['contains spaces and symbols', 'bad id <script>'],
    ['too long', 'a'.repeat(65)],
    ['too short', 'abc'],
  ])('replaced when invalid (%s)', async (_label, bad) => {
    const res = await request(app).get('/api/profile').set('X-Request-Id', bad);
    expect(res.headers['x-request-id']).toMatch(UUID_V4);
    expect(lastHit().headers['x-request-id']).toBe(res.headers['x-request-id']);
  });

  test('present on gateway-generated responses too (404, 413)', async () => {
    expect((await request(app).get('/nope')).headers['x-request-id']).toMatch(UUID_V4);
    expect((await request(app).get('/internal/users/x/auth-state')).headers['x-request-id']).toMatch(UUID_V4);
  });
});

describe('security headers', () => {
  test('helmet headers on proxied and gateway responses; X-Powered-By removed', async () => {
    for (const res of [await request(app).get('/api/profile'), await request(app).get('/health')]) {
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(res.headers['x-powered-by']).toBeUndefined(); // stub sends one; stripped
    }
  });

  test('CORS exposes X-Request-Id and Retry-After to the frontend', async () => {
    const res = await request(app).get('/api/profile').set('Origin', 'http://localhost:5174');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5174');
    expect(res.headers['access-control-expose-headers']).toMatch(/X-Request-Id/);
    expect(res.headers['access-control-expose-headers']).toMatch(/Retry-After/);
  });

  test('the removed legacy frontend origin (:5173) is no longer allowed', async () => {
    const res = await request(app).get('/api/profile').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
