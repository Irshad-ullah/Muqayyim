import http from 'http';
import request from 'supertest';

// The gateway must pass the client IP downstream (X-Forwarded-For) so Core can
// log it on lockouts and rate limiting can key on it.
let seen = null;
const upstream = http.createServer((req, res) => {
  seen = req.headers;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{}');
});

let app;

beforeAll(async () => {
  await new Promise((resolve) => upstream.listen(0, resolve));
  const url = `http://localhost:${upstream.address().port}`;
  process.env.AUTH_SERVICE_URL = url;
  process.env.CV_SERVICE_URL = url;
  ({ default: app } = await import('../app.js'));
});

afterAll(() => new Promise((resolve) => upstream.close(resolve)));

test('proxied requests carry X-Forwarded-For', async () => {
  await request(app).post('/api/auth/login').send({});
  expect(seen['x-forwarded-for']).toBeDefined();
  expect(seen['x-forwarded-for']).toMatch(/127\.0\.0\.1|::1/);
});

test('trust proxy defaults to loopback', () => {
  // Express compiles the setting into a function; loopback addresses are trusted, others are not.
  const trust = app.get('trust proxy fn');
  expect(trust('127.0.0.1', 0)).toBe(true);
  expect(trust('203.0.113.9', 0)).toBe(false);
});
