import http from 'http';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb } from './helpers.js';
import './authMocks.js';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { default: AdminLog } = await import('../backend/admin/models/AdminLog.js');

// ── Fake AIServices /internal/professions ───────────────────────────────────
const aiState = { up: true, calls: [], next: null };
const ONET_DEV = {
  profession_id: 'onet:15-1252.00',
  title: 'Software Developers',
  alt_titles: ['Software Engineer'],
  description: 'Develop software.',
  category: 'Development',
  source: 'onet',
  source_code: '15-1252.00',
  source_version: 'O*NET 31.0',
  skills: [
    { name: 'Python', key: 'python', type: 'technology', hot: true, in_demand: true, original_label: 'Python' },
    { name: 'Java', key: 'java', type: 'technology', hot: true, in_demand: false, original_label: 'Oracle Java' },
  ],
  active: true,
  inactive_reason: null,
};

const ai = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!aiState.up) return req.socket.destroy();
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) return json(403, {});
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : undefined;
    aiState.calls.push({ method: req.method, path: decodeURIComponent(url.pathname), query: Object.fromEntries(url.searchParams), body });
    if (aiState.next) {
      const { status, payload } = aiState.next;
      aiState.next = null;
      return json(status, payload);
    }
    if (req.method === 'GET' && url.pathname === '/internal/professions') {
      return json(200, { success: true, data: [ONET_DEV], pagination: { page: 1, limit: 20, total: 1, pages: 1 } });
    }
    if (req.method === 'POST' && url.pathname === '/internal/professions') {
      return json(201, {
        success: true,
        data: {
          profession_id: 'manual:abc123', source: 'manual', source_code: body.source_code || '', alt_titles: body.alt_titles || [],
          title: body.title, category: body.category || 'Other', skills: (body.skills || []).map((s) => ({ ...s, key: s.name.toLowerCase() })),
          active: (body.skills || []).length >= 5,
        },
      });
    }
    const one = url.pathname.match(/^\/internal\/professions\/(.+)$/);
    if (one) {
      const id = decodeURIComponent(one[1]);
      if (id !== ONET_DEV.profession_id) return json(404, { success: false, code: 'NOT_FOUND', message: 'Profession not found' });
      if (req.method === 'PATCH') return json(200, { success: true, data: { ...ONET_DEV, ...body } });
      if (req.method === 'DELETE') return json(200, { success: true, data: { ...ONET_DEV, active: false, inactive_reason: 'deleted by admin' } });
    }
    return json(404, {});
  });
  return undefined;
});

let admin;
let adminToken;
let seekerToken;
const sign = (u) => jwt.sign({ userId: String(u._id), id: String(u._id), role: u.role }, process.env.JWT_SECRET);
const auth = (r, token = adminToken) => r.set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  await new Promise((r) => ai.listen(0, r));
  process.env.AI_SERVICE_URL = `http://localhost:${ai.address().port}`;
  await connectTestDb();
  admin = await User.create({ name: 'Prof Admin', email: 'prof-admin@example.com', password: 'admin1234', role: 'Admin' });
  const seeker = await User.create({ name: 'Seeker', email: 'prof-seeker@example.com', password: 'abcd1234' });
  adminToken = sign(admin);
  seekerToken = sign(seeker);
});

afterAll(async () => {
  process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
  await new Promise((r) => ai.close(r));
  await dropTestDb();
});

beforeEach(() => {
  aiState.up = true;
  aiState.calls = [];
  aiState.next = null;
});

describe('/api/admin/professions pass-through to AIServices', () => {
  test('admins only', async () => {
    const res = await auth(request(app).get('/api/admin/professions'), seekerToken);
    expect(res.status).toBe(403);
    expect(aiState.calls).toHaveLength(0);
  });

  test('list keeps the envelope, maps the query and adds the old field names', async () => {
    const res = await auth(request(app).get('/api/admin/professions?page=1&limit=20&search=dev&category=Development&isActive=true&source=onet'));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 1, pages: 1 });
    const [p] = res.body.data;
    expect(p).toMatchObject({
      _id: 'onet:15-1252.00',
      profession_id: 'onet:15-1252.00',
      code: '15-1252.00',
      alternativeTitles: ['Software Engineer'],
      requiredSkills: ['Python', 'Java'],
      isActive: true,
      source: 'onet',
    });
    expect(aiState.calls[0].query).toEqual({ page: '1', limit: '20', search: 'dev', category: 'Development', active: 'true', source: 'onet' });
  });

  test('create maps old field names, sends the actor and writes an AdminLog entry', async () => {
    const res = await auth(request(app).post('/api/admin/professions')).send({
      title: 'Platform Engineer',
      code: 'PE-1',
      category: 'Infrastructure & Cloud',
      alternativeTitles: ['Platform Dev'],
      requiredSkills: ['Kubernetes', 'Terraform', { name: 'Go', type: 'optional' }],
      isActive: true,
      source: 'esco', // ignored: admin-created professions are always manual
      junk: 'dropped',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ _id: 'manual:abc123', title: 'Platform Engineer', code: 'PE-1', requiredSkills: ['Kubernetes', 'Terraform', 'Go'] });
    expect(aiState.calls[0].body).toEqual({
      title: 'Platform Engineer',
      category: 'Infrastructure & Cloud',
      source_code: 'PE-1',
      alt_titles: ['Platform Dev'],
      active: true,
      skills: [{ name: 'Kubernetes' }, { name: 'Terraform' }, { name: 'Go', type: 'optional' }],
      actor: String(admin._id),
    });
    const log = await AdminLog.findOne({ action: 'CREATE_PROFESSION', resourceId: 'manual:abc123' });
    expect(log.details).toEqual({ title: 'Platform Engineer' });
  });

  test('create without a title is rejected before calling AIServices', async () => {
    const res = await auth(request(app).post('/api/admin/professions')).send({ code: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(aiState.calls).toHaveLength(0);
  });

  test('AIServices validation (422) becomes 400 VALIDATION_ERROR with the field errors', async () => {
    aiState.next = { status: 422, payload: { success: false, code: 'VALIDATION_ERROR', message: 'Invalid request', errors: [{ field: 'title', message: 'too short' }] } };
    const res = await auth(request(app).post('/api/admin/professions')).send({ title: 'X' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid request', errors: [{ field: 'title', message: 'too short' }] });
  });

  test('update passes through as PATCH; conflicts keep their code', async () => {
    const ok = await auth(request(app).put('/api/admin/professions/onet:15-1252.00')).send({ category: 'Data & AI', isActive: false });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ _id: 'onet:15-1252.00', category: 'Data & AI', isActive: false });
    expect(aiState.calls[0]).toMatchObject({ method: 'PATCH', path: '/internal/professions/onet:15-1252.00', body: { category: 'Data & AI', active: false } });
    expect(await AdminLog.countDocuments({ action: 'UPDATE_PROFESSION', resourceId: 'onet:15-1252.00' })).toBe(1);

    aiState.next = { status: 409, payload: { success: false, code: 'IMPORTED_PROFESSION', message: 'O*NET professions are updated by re-importing' } };
    const locked = await auth(request(app).put('/api/admin/professions/onet:15-1252.00')).send({ title: 'Coders' });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('IMPORTED_PROFESSION');
    expect(await AdminLog.countDocuments({ action: 'UPDATE_PROFESSION' })).toBe(1);
  });

  test('delete is a soft delete with the old envelope; unknown ids are 404', async () => {
    const res = await auth(request(app).delete('/api/admin/professions/onet:15-1252.00'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Profession deleted' });
    expect(aiState.calls[0]).toMatchObject({ method: 'DELETE', query: { actor: String(admin._id) } });
    expect(await AdminLog.countDocuments({ action: 'DELETE_PROFESSION', resourceId: 'onet:15-1252.00' })).toBe(1);

    const missing = await auth(request(app).delete('/api/admin/professions/manual:nope'));
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('NOT_FOUND');
  });

  test('AIServices down → 503 PROFESSIONS_UNAVAILABLE, no AdminLog entry', async () => {
    aiState.up = false;
    const before = await AdminLog.countDocuments({});
    for (const r of [
      request(app).get('/api/admin/professions'),
      request(app).post('/api/admin/professions').send({ title: 'Something' }),
      request(app).put('/api/admin/professions/onet:15-1252.00').send({ category: 'Other' }),
      request(app).delete('/api/admin/professions/onet:15-1252.00'),
    ]) {
      const res = await auth(r);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('PROFESSIONS_UNAVAILABLE');
    }
    expect(await AdminLog.countDocuments({})).toBe(before);
  });

  test('AIServices 5xx → 503', async () => {
    aiState.next = { status: 500, payload: { success: false, code: 'INTERNAL_ERROR' } };
    const res = await auth(request(app).get('/api/admin/professions'));
    expect(res.status).toBe(503);
  });
});
