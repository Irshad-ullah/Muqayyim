import http from 'http';
import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb } from './helpers.js';
import './authMocks.js';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { userRef } = await import('../backend/controllers/careerMatchController.js');

// ── Fake AIServices /internal/matching ───────────────────────────────────────
const ai = { up: true, calls: [], next: null, hang: false };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  ai.calls.push({ path: decodeURIComponent(url.pathname), query: Object.fromEntries(url.searchParams), headers: req.headers });
  if (!ai.up) return req.socket.destroy();
  if (ai.hang) return undefined;
  const json = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  if (ai.next) { const { status, body, headers } = ai.next; ai.next = null; return json(status, body, headers); }
  const userId = req.headers['x-user-id'];
  if (url.pathname !== '/internal/matching/matches') {
    return json(200, { success: true, data: { profession_id: 'onet:15-1252.00', members: [{ owner: userId }] } });
  }
  return json(200, { success: true, data: { state: 'ready', owner: userId, results: [{ title: 'A' }, { title: 'B' }] } });
});

let alice;
let bob;
const sign = (u) => jwt.sign({ userId: String(u._id), id: String(u._id), role: u.role }, process.env.JWT_SECRET);
const as = (r, user) => r.set('Authorization', `Bearer ${sign(user)}`);

beforeAll(async () => {
  await new Promise((r) => server.listen(0, r));
  process.env.AI_SERVICE_URL = `http://localhost:${server.address().port}`;
  process.env.MATCHING_TIMEOUT_MS = '400';
  await connectTestDb();
  alice = await User.create({ name: 'Alice Test', email: 'cm-alice@example.com', password: 'abcd1234' });
  bob = await User.create({ name: 'Bob Test', email: 'cm-bob@example.com', password: 'abcd1234' });
});

afterAll(async () => {
  process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
  delete process.env.MATCHING_TIMEOUT_MS;
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await dropTestDb();
});

beforeEach(() => Object.assign(ai, { up: true, calls: [], next: null, hang: false }));

describe('identity', () => {
  test('no token → 401 and nothing reaches AIServices', async () => {
    expect((await request(app).get('/api/career-matches')).status).toBe(401);
    expect((await request(app).get('/api/career-matches/onet:15-1252.00')).status).toBe(401);
    expect(ai.calls).toHaveLength(0);
  });

  test('the user id comes only from the verified token; another user\'s id is ignored everywhere', async () => {
    const res = await as(request(app).get(`/api/career-matches?userId=${bob._id}&user_id=${bob._id}`), alice)
      .set('X-User-Id', String(bob._id)).send({ userId: String(bob._id) });
    expect(res.status).toBe(200);
    expect(res.body.data.owner).toBe(String(alice._id));
    expect(ai.calls[0].path).toBe('/internal/matching/matches'); // no user id in any path
    expect(ai.calls[0].headers['x-user-id']).toBe(String(alice._id));
    expect(ai.calls[0].query).toEqual({}); // the query string is not forwarded
    expect(ai.calls[0].headers['x-internal-key']).toBe(process.env.INTERNAL_API_KEY);
    expect(ai.calls[0].headers.authorization).toBeUndefined();
    const detail = await as(request(app).get('/api/career-matches/onet:15-1252.00'), bob);
    expect(detail.body.data.members[0].owner).toBe(String(bob._id));
    expect(ai.calls[1].path).toBe('/internal/matching/matches/onet:15-1252.00');
    expect(ai.calls[1].headers['x-user-id']).toBe(String(bob._id));
  });
});

describe('validation', () => {
  test.each(['nope', 'onet:', 'onet:15 1252', 'other:15-1252.00', `onet:${'x'.repeat(101)}`])(
    'malformed profession id %s → 404 without calling AI', async (id) => {
      const res = await as(request(app).get(`/api/career-matches/${encodeURIComponent(id)}`), alice);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, code: 'PROFESSION_NOT_FOUND', message: 'That career was not found.' });
      expect(ai.calls).toHaveLength(0);
    });

  test('unknown or inactive profession → AI\'s 404 is passed through', async () => {
    ai.next = { status: 404, body: { success: false, code: 'PROFESSION_NOT_FOUND', message: 'That career was not found.' } };
    const res = await as(request(app).get('/api/career-matches/esco:gone-001'), alice);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PROFESSION_NOT_FOUND');
  });
});

describe('errors the page can tell apart (FR7.10)', () => {
  test.each(['EMBEDDINGS_PENDING', 'MODEL_LOADING', 'INDEX_BUILDING', 'NO_PROFESSIONS'])(
    '%s → 503 with the code, message and Retry-After', async (code) => {
      ai.next = { status: 503, body: { success: false, code, message: 'Please try again shortly.', retry_after_seconds: 10 },
        headers: { 'Retry-After': '10' } };
      const res = await as(request(app).get('/api/career-matches'), alice);
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ success: false, code, message: 'Please try again shortly.', retryAfterSeconds: 10 });
      expect(res.headers['retry-after']).toBe('10');
    });

  test('AI unreachable → 503 MATCHING_UNAVAILABLE', async () => {
    ai.up = false;
    const res = await as(request(app).get('/api/career-matches'), alice);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MATCHING_UNAVAILABLE');
    expect(res.body.message).not.toMatch(/ECONN|localhost|internal|stack/i);
  });

  test('AI too slow → 504 MATCHING_TIMEOUT', async () => {
    ai.hang = true;
    const res = await as(request(app).get('/api/career-matches'), alice);
    expect(res.status).toBe(504);
    expect(res.body.code).toBe('MATCHING_TIMEOUT');
  });

  test('an unexpected AI error is not shown to the user', async () => {
    ai.next = { status: 500, body: { success: false, code: 'INTERNAL_ERROR', message: 'KeyError: skills at service.py:42' } };
    const res = await as(request(app).get('/api/career-matches'), alice);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, code: 'MATCHING_UNAVAILABLE',
      message: 'Career matching is temporarily unavailable. Please try again shortly.' });
  });
});

describe('logging', () => {
  test('logs a hash of the user id, the status and the count — never the id or skills', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      await as(request(app).get('/api/career-matches'), alice);
      const lines = info.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('[CareerMatches]'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(new RegExp(`user=${userRef(alice._id)} status=200 results=2 ms=\\d+`));
      expect(lines[0]).not.toContain(String(alice._id));
      expect(lines[0]).not.toContain('cm-alice');
    } finally {
      info.mockRestore();
    }
  });
});
