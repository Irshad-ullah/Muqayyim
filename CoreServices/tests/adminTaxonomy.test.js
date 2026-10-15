import http from 'http';
import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb } from './helpers.js';
import './authMocks.js';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { default: AdminLog } = await import('../backend/admin/models/AdminLog.js');
const { default: ErrorLog } = await import('../backend/models/ErrorLog.js');

// ── Fake AIServices /internal/admin/taxonomy ────────────────────────────────
const ai = { up: true, calls: [], next: null, hangOnUpload: false };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const call = { method: req.method, path: decodeURIComponent(url.pathname), query: Object.fromEntries(url.searchParams),
    headers: req.headers, bytes: 0, complete: false };
  ai.calls.push(call);
  if (!ai.up) return req.socket.destroy();
  const chunks = [];
  req.on('data', (c) => { call.bytes += c.length; chunks.push(c); });
  req.on('aborted', () => { call.aborted = true; });
  req.on('end', () => {
    call.complete = true;
    call.body = Buffer.concat(chunks).toString('utf8');
    if (ai.hangOnUpload) return undefined;
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (ai.next) { const { status, body } = ai.next; ai.next = null; return json(status, body); }
    if (req.method === 'POST' && url.pathname.endsWith('/jobs')) {
      return json(202, { success: true, data: { job_id: 'job-1', status: 'uploaded', source: 'esco', dataset_version: 'ESCO v1.2.1',
        file_summary: { mode: 'files', upload_bytes: call.bytes, ignored_count: 0 } } });
    }
    return json(200, { success: true, data: { echo: url.pathname }, pagination: { total: 0 } });
  });
  return undefined;
});

let admin;
let adminToken;
let seekerToken;
const sign = (u) => jwt.sign({ userId: String(u._id), id: String(u._id), role: u.role }, process.env.JWT_SECRET);
const as = (r, token = adminToken) => r.set('Authorization', `Bearer ${token}`);
const multipart = (r) => r.field('source', 'esco').field('dataset_version', 'ESCO v1.2.1').field('created_by', 'spoofed-admin')
  .attach('files', Buffer.from('conceptUri,label\nx,y\n'), 'occupations_en.csv');

beforeAll(async () => {
  await new Promise((r) => server.listen(0, r));
  process.env.AI_SERVICE_URL = `http://localhost:${server.address().port}`;
  await connectTestDb();
  await ErrorLog.init();
  admin = await User.create({ name: 'Tax Admin', email: 'tax-admin@example.com', password: 'admin1234', role: 'Admin' });
  const seeker = await User.create({ name: 'Seeker', email: 'tax-seeker@example.com', password: 'abcd1234' });
  adminToken = sign(admin);
  seekerToken = sign(seeker);
});

afterAll(async () => {
  process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
  await new Promise((r) => server.close(r));
  await dropTestDb();
});

beforeEach(async () => {
  Object.assign(ai, { up: true, calls: [], next: null, hangOnUpload: false });
  await AdminLog.deleteMany({});
});

const lastLog = () => AdminLog.findOne({}).sort({ createdAt: -1 }).lean();

describe('access and identity', () => {
  test('a non-admin upload is refused before anything reaches AIServices', async () => {
    const noToken = await multipart(request(app).post('/api/admin/taxonomy/jobs'));
    expect(noToken.status).toBe(401);
    const seeker = await multipart(as(request(app).post('/api/admin/taxonomy/jobs'), seekerToken));
    expect(seeker.status).toBe(403);
    expect(ai.calls).toHaveLength(0);
    expect(await AdminLog.countDocuments({})).toBe(0);
  });

  test('every taxonomy route is admin-only', async () => {
    for (const [method, path] of [['get', '/api/admin/taxonomy/jobs'], ['post', '/api/admin/taxonomy/jobs/j/publish'],
      ['post', '/api/admin/taxonomy/snapshots/s/restore'], ['put', '/api/admin/taxonomy/skills/React'],
      ['patch', '/api/admin/taxonomy/professions/p'], ['get', '/api/admin/taxonomy/sources']]) {
      const res = await as(request(app)[method](path), seekerToken).send({});
      expect(res.status).toBe(403);
    }
    expect(ai.calls).toHaveLength(0);
  });

  test('the upload is streamed with the verified admin id and only the allowed headers', async () => {
    const res = await multipart(as(request(app).post('/api/admin/taxonomy/jobs')))
      .set('X-Admin-Id', 'spoofed-header').set('Cookie', 'session=secret').set('X-Request-Id', 'req-abcdef12');
    expect(res.status).toBe(202);
    expect(res.body.data.job_id).toBe('job-1');
    const [call] = ai.calls;
    expect(call.path).toBe('/internal/admin/taxonomy/jobs');
    expect(call.headers['x-admin-id']).toBe(String(admin._id));
    expect(call.headers['x-internal-key']).toBe(process.env.INTERNAL_API_KEY);
    expect(call.headers['x-request-id']).toBe('req-abcdef12');
    expect(call.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(Number(call.headers['content-length'])).toBe(call.bytes);
    expect(call.headers.authorization).toBeUndefined();
    expect(call.headers.cookie).toBeUndefined();
    expect(call.body).toContain('conceptUri,label'); // streamed unchanged (AI ignores the created_by field)
  });

  test('identity fields in JSON bodies are stripped; the admin id comes from the JWT', async () => {
    await as(request(app).post('/api/admin/taxonomy/jobs/j1/publish'))
      .send({ acknowledge_background_warning: true, actor: 'spoofed', created_by: 'spoofed', adminId: 'spoofed' });
    const [call] = ai.calls;
    expect(JSON.parse(call.body)).toEqual({ acknowledge_background_warning: true });
    expect(call.headers['x-admin-id']).toBe(String(admin._id));
    expect(call.headers.authorization).toBeUndefined();
  });
});

describe('pass-through', () => {
  test('GET routes forward the query and the path (encoded names)', async () => {
    await as(request(app).get('/api/admin/taxonomy/jobs?page=2&status=previewed'));
    await as(request(app).get('/api/admin/taxonomy/skills/CI%2FCD'));
    expect(ai.calls[0]).toMatchObject({ method: 'GET', path: '/internal/admin/taxonomy/jobs', query: { page: '2', status: 'previewed' } });
    expect(ai.calls[1].path).toBe('/internal/admin/taxonomy/skills/CI/CD');
    expect(await AdminLog.countDocuments({})).toBe(0); // reads are not audited
  });

  test.each([
    [409, 'TAXONOMY_BUSY', 'post', '/api/admin/taxonomy/jobs/j1/publish'],
    [409, 'JOB_STATE', 'post', '/api/admin/taxonomy/jobs/j1/preview'],
    [409, 'LIVE_DATA_CHANGED', 'post', '/api/admin/taxonomy/jobs/j1/publish'],
    [422, 'BACKGROUND_ACK_REQUIRED', 'post', '/api/admin/taxonomy/jobs/j1/publish'],
    [409, 'SEED_READ_ONLY', 'put', '/api/admin/taxonomy/skills/Python'],
    [413, 'UPLOAD_TOO_LARGE', 'post', '/api/admin/taxonomy/jobs/j1/cancel'],
    [500, 'EDIT_FAILED', 'patch', '/api/admin/taxonomy/professions/onet:15-1252.00'],
  ])('AI %i %s is passed through unchanged and audited', async (status, code, method, path) => {
    const body = { success: false, code, message: `ai says ${code}`, extra: 1 };
    ai.next = { status, body };
    const res = await as(request(app)[method](path)).send({ description: 'x' });
    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
    const log = await lastLog();
    expect(log.status).toBe('failure');
    expect(log.details.result).toEqual({ status, code });
  });

  test('AIServices unreachable → 503, audited as a failure', async () => {
    ai.up = false;
    const res = await as(request(app).post('/api/admin/taxonomy/snapshots/s1/restore')).send({});
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('TAXONOMY_UNAVAILABLE');
    const log = await lastLog();
    expect(log).toMatchObject({ action: 'TAXONOMY_RESTORE', resourceId: 's1', status: 'failure' });
    expect(log.details.result).toEqual({ status: 503, code: 'TAXONOMY_UNAVAILABLE' });
  });

  test('upload to an unreachable AIServices → 503', async () => {
    ai.up = false;
    const res = await multipart(as(request(app).post('/api/admin/taxonomy/jobs')));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('TAXONOMY_UNAVAILABLE');
  });

  test('an upload without multipart or Content-Length is refused before AIServices', async () => {
    const json = await as(request(app).post('/api/admin/taxonomy/jobs')).send({ a: 1 });
    expect(json.status).toBe(422);
    expect(ai.calls).toHaveLength(0);
  });
});

describe('AdminLog', () => {
  test('each action writes an entry after AIServices answers', async () => {
    await multipart(as(request(app).post('/api/admin/taxonomy/jobs')));
    await as(request(app).post('/api/admin/taxonomy/jobs/job-1/preview')).send({});
    await as(request(app).post('/api/admin/taxonomy/jobs/job-1/publish')).send({ acknowledge_background_warning: true });
    await as(request(app).post('/api/admin/taxonomy/jobs/job-1/cancel')).send({});
    await as(request(app).post('/api/admin/taxonomy/snapshots/s1/restore')).send({});
    await as(request(app).patch('/api/admin/taxonomy/professions/p1')).send({ title: 'T', actor: 'x' });
    await as(request(app).post('/api/admin/taxonomy/professions/p1/reset')).send({ fields: ['title'] });
    await as(request(app).post('/api/admin/taxonomy/skills/validate')).send({ name: 'Foo' });
    await as(request(app).post('/api/admin/taxonomy/skills')).send({ name: 'Foo', description: 'd', category: 'c' });
    await as(request(app).put('/api/admin/taxonomy/skills/Foo')).send({ description: 'e' });
    const logs = await AdminLog.find({}).sort({ createdAt: 1 }).lean();
    expect(logs.map((l) => l.action)).toEqual(['TAXONOMY_UPLOAD', 'TAXONOMY_PREVIEW', 'TAXONOMY_PUBLISH', 'TAXONOMY_CANCEL',
      'TAXONOMY_RESTORE', 'TAXONOMY_EDIT', 'TAXONOMY_EDIT', 'TAXONOMY_VALIDATE', 'TAXONOMY_EDIT', 'TAXONOMY_EDIT']);
    expect(logs.every((l) => String(l.adminId) === String(admin._id) && l.resource === 'Taxonomy')).toBe(true);
    const upload = logs[0];
    expect(upload).toMatchObject({ resourceId: 'job-1', status: 'success' });
    expect(upload.details).toMatchObject({ jobId: 'job-1', source: 'esco', mode: 'files', result: { status: 202, code: 'OK' } });
    expect(JSON.stringify(upload)).not.toContain('conceptUri'); // never file contents
    expect(logs[2].details.acknowledgeBackgroundWarning).toBe(true);
    expect(logs[5].details).toMatchObject({ target: 'profession', fields: ['title'] });
  });

  test('a failed log write does not change the response but is logged as an error', async () => {
    const spy = jest.spyOn(AdminLog, 'create').mockRejectedValueOnce(Object.assign(new Error('db down'), { name: 'MongoNetworkError' }));
    const res = await as(request(app).post('/api/admin/taxonomy/jobs/j1/preview')).send({});
    spy.mockRestore();
    expect(res.status).toBe(200);
    const entry = await ErrorLog.findOne({ errorType: 'ADMIN_LOG_WRITE_FAILED' }).lean();
    expect(entry.level).toBe('error');
    expect(entry.message).toContain('TAXONOMY_PREVIEW');
  });

  test('a client aborting the upload stops the AI request and is audited; no job is created', async () => {
    const port = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const boundary = 'X-BOUNDARY';
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="skills_en.csv"\r\n\r\n`;
    await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: port.address().port, method: 'POST', path: '/api/admin/taxonomy/jobs',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': 10 * 1024 * 1024 } });
      req.on('error', () => resolve());
      req.write(head + 'x'.repeat(64 * 1024));
      setTimeout(() => { req.destroy(); setTimeout(resolve, 300); }, 300);
    });
    await new Promise((r) => port.close(r));
    const [call] = ai.calls;
    expect(call.complete).toBe(false); // AI never received the whole form → no job
    expect(call.bytes).toBeLessThan(10 * 1024 * 1024);
    const log = await lastLog();
    expect(log).toMatchObject({ action: 'TAXONOMY_UPLOAD', status: 'failure' });
    expect(log.details.result).toEqual({ status: 499, code: 'CLIENT_ABORTED' });
  });
});
