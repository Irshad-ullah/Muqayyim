import crypto from 'node:crypto';
import http from 'http';
import request from 'supertest';
import { startStub, useTargets } from './stub.js';

// 09c Part 7: the admin taxonomy routes at the gateway — streamed upload with its own
// size limit and timeout, the publish/restore rate limit, and nothing else loosened.
const MB = 1024 * 1024;
const SECRET = 'gateway-test-secret';
let stub;
let createApp;
let createServer;
let loadConfig;

beforeAll(async () => {
  stub = await startStub();
  useTargets(stub.url);
  ({ createApp, createServer } = await import('../app.js'));
  ({ loadConfig } = await import('../config.js'));
});

afterAll(() => stub.close());

const configWith = (env) => loadConfig({ ...process.env, AUTH_SERVICE_URL: stub.url, CV_SERVICE_URL: stub.url,
  RATE_LIMIT_ENABLED: 'false', ...env });

const sign = (claims, secret = SECRET, alg = 'HS256') => {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = part({ alg, typ: 'JWT' });
  const body = part({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
};

describe('taxonomy upload: size and streaming', () => {
  test('the default limits: 100 MB for the taxonomy upload, 1 MB for everything else', () => {
    const config = loadConfig({});
    expect(config.maxTaxonomyUploadBytes).toBe(100 * MB);
    expect(config.maxBodyBytes).toBe(1 * MB);
    expect(config.taxonomyUploadTimeoutMs).toBe(5 * 60 * 1000);
    expect(config.rateLimits.taxonomyPublish).toEqual({ max: 5, windowMs: 15 * 60 * 1000 });
  });

  test('an upload within the limit is streamed to Core byte for byte (no body parser)', async () => {
    const app = createApp(configWith({ GATEWAY_MAX_TAXONOMY_UPLOAD_BYTES: String(4 * MB) }));
    const before = stub.hits.length;
    const res = await request(app).post('/api/admin/taxonomy/jobs')
      .field('source', 'esco').attach('files', Buffer.alloc(3 * MB, 'a'), 'skills_en.csv');
    expect(res.status).toBe(200);
    const hit = stub.hits[before];
    expect(hit.url).toBe('/api/admin/taxonomy/jobs');
    expect(hit.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(hit.size).toBe(Number(hit.headers['content-length']));
    expect(hit.size).toBeGreaterThan(3 * MB);
  });

  test('Content-Length over the limit → 413, nothing forwarded', async () => {
    const app = createApp(configWith({ GATEWAY_MAX_TAXONOMY_UPLOAD_BYTES: String(2 * MB) }));
    const before = stub.hits.length;
    const res = await request(app).post('/api/admin/taxonomy/jobs').attach('files', Buffer.alloc(3 * MB), 'x.csv');
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ success: false, code: 'PAYLOAD_TOO_LARGE' });
    expect(res.body.message).toMatch(/limit 2 MB/);
    expect(stub.hits.length).toBe(before);
  });

  test('every other admin route keeps the 1 MB limit (2 MB JSON → 413)', async () => {
    const app = createApp(configWith({}));
    const body = `{"description":"${'a'.repeat(2 * MB)}"}`;
    for (const [method, path] of [['put', '/api/admin/taxonomy/skills/React'], ['post', '/api/admin/taxonomy/jobs/j1/publish'],
      ['patch', '/api/admin/taxonomy/professions/p1'], ['put', '/api/admin/users/u1'], ['get', '/api/admin/taxonomy/jobs']]) {
      const res = await request(app)[method](path).set('Content-Type', 'application/json').send(body);
      expect(res.status).toBe(413);
      expect(res.body.message).toMatch(/limit 1 MB/);
    }
  });

  test('a chunked upload (no Content-Length) is counted while streaming and stopped at the limit', async () => {
    const server = createServer(createApp(configWith({ GATEWAY_MAX_TAXONOMY_UPLOAD_BYTES: String(1 * MB) })),
      configWith({ GATEWAY_MAX_TAXONOMY_UPLOAD_BYTES: String(1 * MB) }));
    await new Promise((r) => server.listen(0, r));
    const before = stub.hits.length;
    const result = await new Promise((resolve) => {
      const req = http.request({ port: server.address().port, method: 'POST', path: '/api/admin/taxonomy/jobs',
        headers: { 'Content-Type': 'multipart/form-data; boundary=b', 'Transfer-Encoding': 'chunked' } });
      let sent = 0;
      req.on('response', (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text), sent }));
      });
      req.on('error', () => resolve({ status: 'reset', sent }));
      const pump = () => {
        while (sent < 8 * MB) {
          sent += 64 * 1024;
          if (!req.write(Buffer.alloc(64 * 1024))) { req.once('drain', pump); return; }
        }
        req.end();
      };
      pump();
    });
    await new Promise((r) => server.close(r));
    expect(result.status).toBe(413);
    expect(result.body.code).toBe('PAYLOAD_TOO_LARGE');
    // The stub (Core) never received a complete request past the limit.
    const forwarded = stub.hits.slice(before);
    expect(forwarded.every((h) => h.size <= 1 * MB + 64 * 1024)).toBe(true);
  });

  test('Expect: 100-continue with an oversized Content-Length → 413 before the body is sent', async () => {
    const config = configWith({ GATEWAY_MAX_TAXONOMY_UPLOAD_BYTES: String(1 * MB) });
    const server = createServer(createApp(config), config);
    await new Promise((r) => server.listen(0, r));
    const result = await new Promise((resolve) => {
      const req = http.request({ port: server.address().port, method: 'POST', path: '/api/admin/taxonomy/jobs',
        headers: { 'Content-Type': 'multipart/form-data; boundary=b', 'Content-Length': String(101 * MB),
          Expect: '100-continue' } });
      let continued = false;
      req.on('continue', () => { continued = true; });
      req.on('response', (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, code: JSON.parse(text).code, continued }));
      });
      req.on('error', () => resolve({ status: 'error', continued }));
      req.flushHeaders();
    });
    await new Promise((r) => server.close(r));
    expect(result).toEqual({ status: 413, code: 'PAYLOAD_TOO_LARGE', continued: false });
  });
});

describe('taxonomy upload timeout', () => {
  test('the upload route waits for the long timeout; other routes keep the normal one', async () => {
    const app = createApp(configWith({ GATEWAY_PROXY_TIMEOUT_MS: '300', GATEWAY_TAXONOMY_UPLOAD_TIMEOUT_MS: '1500' }));
    let started = Date.now();
    const other = await request(app).post('/api/admin/taxonomy/jobs/j1/publish').set('x-stub-hang', '1').send({});
    const otherMs = Date.now() - started;
    started = Date.now();
    const upload = await request(app).post('/api/admin/taxonomy/jobs').set('x-stub-hang', '1')
      .attach('files', Buffer.alloc(1024), 'x.csv');
    const uploadMs = Date.now() - started;
    expect(other.status).toBe(504);
    expect(upload.status).toBe(504);
    expect(otherMs).toBeLessThan(1200);
    expect(uploadMs).toBeGreaterThanOrEqual(1400);
  });
});

describe('taxonomy publish / restore rate limit', () => {
  const limited = () => createApp(configWith({ RATE_LIMIT_ENABLED: 'true', JWT_SECRET: SECRET,
    RATE_LIMIT_GLOBAL_MAX: '1000' }));

  test('5 per 15 minutes per user, shared by publish and restore; other users unaffected', async () => {
    const app = limited();
    const alice = `Bearer ${sign({ userId: 'alice-1' })}`;
    const bob = `Bearer ${sign({ userId: 'bob-2' })}`;
    for (let i = 0; i < 3; i += 1) {
      expect((await request(app).post(`/api/admin/taxonomy/jobs/j${i}/publish`).set('Authorization', alice).send({})).status).toBe(200);
    }
    for (let i = 0; i < 2; i += 1) {
      expect((await request(app).post(`/api/admin/taxonomy/snapshots/s${i}/restore`).set('Authorization', alice).send({})).status).toBe(200);
    }
    const blocked = await request(app).post('/api/admin/taxonomy/jobs/j9/publish').set('Authorization', alice).send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ success: false, code: 'RATE_LIMITED' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // Same IP, another (valid) user: own budget.
    expect((await request(app).post('/api/admin/taxonomy/jobs/j1/publish').set('Authorization', bob).send({})).status).toBe(200);
    // Other admin routes are not limited by this budget.
    expect((await request(app).post('/api/admin/taxonomy/jobs/j1/preview').set('Authorization', alice).send({})).status).toBe(200);
  });

  test.each([
    ['no token', undefined],
    ['a forged token (wrong secret)', `Bearer ${sign({ userId: 'mallory' }, 'not-the-secret')}`],
    ['an expired token', `Bearer ${sign({ userId: 'old', exp: Math.floor(Date.now() / 1000) - 10 })}`],
    ['an unsigned alg=none token', `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"userId":"x"}').toString('base64url')}.sig`],
  ])('with %s the limit is keyed by IP (changing user ids does not help)', async (_label, auth) => {
    const app = limited();
    for (let i = 0; i < 5; i += 1) {
      const header = auth && i % 2 ? auth.replace('mallory', `mallory${i}`) : auth;
      const r = request(app).post(`/api/admin/taxonomy/jobs/j${i}/publish`);
      expect((await (header ? r.set('Authorization', header) : r).send({})).status).toBe(200);
    }
    const r = request(app).post('/api/admin/taxonomy/snapshots/s1/restore');
    expect((await (auth ? r.set('Authorization', auth) : r).send({})).status).toBe(429);
  });

  test('without JWT_SECRET the limit falls back to the client IP', async () => {
    const app = createApp(configWith({ RATE_LIMIT_ENABLED: 'true', JWT_SECRET: '', RATE_LIMIT_GLOBAL_MAX: '1000' }));
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/api/admin/taxonomy/jobs/j/publish').set('Authorization', `Bearer ${sign({ userId: `u${i}` })}`).send({});
    }
    const res = await request(app).post('/api/admin/taxonomy/jobs/j/publish').set('Authorization', `Bearer ${sign({ userId: 'u9' })}`).send({});
    expect(res.status).toBe(429);
  });
});

describe('internal routes stay blocked', () => {
  test.each(['/internal/admin/taxonomy/jobs', '/internal/admin/taxonomy/sources', '/internal/professions'])('%s → 404', async (path) => {
    const app = createApp(configWith({}));
    const before = stub.hits.length;
    expect((await request(app).get(path)).status).toBe(404);
    expect((await request(app).post(path).send({})).status).toBe(404);
    expect(stub.hits.length).toBe(before);
  });
});
