import { jest } from '@jest/globals';
import request from 'supertest';
import { startStub, useTargets } from './stub.js';

// Default limits: login 10/15 min (failed only), register 10/h,
// password reset 5/h, CV upload 20/h, global 600/15 min.
let stub;
let app;

beforeAll(async () => {
  stub = await startStub();
  useTargets(stub.url);
  delete process.env.RATE_LIMIT_ENABLED;
  ({ default: app } = await import('../app.js'));
});

afterAll(() => stub.close());

let ipCounter = 0;
// Each test uses its own client IP (trusted from loopback via X-Forwarded-For).
const newIp = () => `203.0.113.${++ipCounter}`;
const post = (path, ip, status = 200) =>
  request(app).post(path).set('X-Forwarded-For', ip).set('x-stub-status', String(status)).send({ any: 'body' });

describe('login limiter', () => {
  test('11th failed login in the window → 429 RATE_LIMITED with Retry-After; another IP is unaffected', async () => {
    const ip = newIp();
    for (let i = 0; i < 10; i++) expect((await post('/api/auth/login', ip, 401)).status).toBe(401);

    const blocked = await post('/api/auth/login', ip, 401);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ success: false, code: 'RATE_LIMITED' });
    expect(blocked.body.message).toMatch(/^Too many requests\. Please try again in \d+ minutes?\.$/);
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers.ratelimit).toBeDefined();
    expect(blocked.headers['ratelimit-policy']).toBeDefined();

    // Blocked requests never reach the service.
    const forwarded = stub.hits.filter((h) => h.headers['x-forwarded-for']?.startsWith(ip)).length;
    expect(forwarded).toBe(10);

    expect((await post('/api/auth/login', newIp(), 401)).status).toBe(401);
  });

  test('successful logins do not count (skipSuccessfulRequests works through the proxy)', async () => {
    const ip = newIp();
    for (let i = 0; i < 15; i++) expect((await post('/api/auth/login', ip, 200)).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await post('/api/auth/login', ip, 401)).status).toBe(401);
    expect((await post('/api/auth/login', ip, 401)).status).toBe(429);
  });

  test('a limit hit is logged as one structured line without tokens or bodies', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ip = newIp();
    for (let i = 0; i < 10; i++) await post('/api/auth/login', ip, 401);
    await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .set('Authorization', 'Bearer secret.jwt.token')
      .set('X-Request-Id', 'rl-test-request-0001')
      .send({ password: 'hunter2hunter2' });

    const lines = warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.startsWith('[RateLimit]'));
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0].slice('[RateLimit] '.length));
    expect(entry).toEqual({ limit: 'login', route: 'POST /api/auth/login', ip, requestId: 'rl-test-request-0001' });
    expect(lines[0]).not.toMatch(/secret\.jwt\.token|hunter2/);
    warn.mockRestore();
  });
});

describe('other limiters', () => {
  test('register: 11th request in the hour → 429', async () => {
    const ip = newIp();
    for (let i = 0; i < 10; i++) expect((await post('/api/auth/register', ip, 201)).status).toBe(201);
    expect((await post('/api/auth/register', ip, 201)).status).toBe(429);
  });

  test('password reset: forgot + reset share one budget, 6th request → 429', async () => {
    const ip = newIp();
    for (let i = 0; i < 3; i++) expect((await post('/api/auth/forgot-password', ip)).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await post(`/api/auth/reset-password/tok${i}`, ip)).status).toBe(200);
    const sixth = await post('/api/auth/forgot-password', ip);
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('RATE_LIMITED');
  });

  test('CV upload: 21st upload in the hour → 429', async () => {
    const ip = newIp();
    for (let i = 0; i < 20; i++) expect((await post('/api/cv/upload', ip)).status).toBe(200);
    expect((await post('/api/cv/upload', ip)).status).toBe(429);
  });

  test('other routes are not affected by the specific limiters', async () => {
    const ip = newIp();
    for (let i = 0; i < 25; i++) expect((await post('/api/cv/parse/abc', ip)).status).toBe(200);
  });
});

describe('never limited', () => {
  test('/health and OPTIONS preflight', async () => {
    const ip = newIp();
    for (let i = 0; i < 15; i++) await post('/api/auth/login', ip, 401); // exhaust login
    for (let i = 0; i < 20; i++) {
      expect((await request(app).get('/health').set('X-Forwarded-For', ip)).status).toBe(200);
      const pre = await request(app)
        .options('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .set('Origin', 'http://localhost:5174')
        .set('Access-Control-Request-Method', 'POST');
      expect(pre.status).toBe(204);
    }
  });
});
