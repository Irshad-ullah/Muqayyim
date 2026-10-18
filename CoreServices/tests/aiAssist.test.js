import http from 'http';
import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb } from './helpers.js';
import './authMocks.js';

process.env.LLM_DELETE_RETRY_DELAYS_MS = '0,5';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { default: Profile } = await import('../backend/models/Profile.js');
const { flushLlmDeletes, retryPendingLlmDeletes } = await import('../backend/services/aiLlmClient.js');
const { default: PendingLlmDeletion } = await import('../backend/models/PendingLlmDeletion.js');
const { educationStatus } = await import('../backend/controllers/aiController.js');
const { AI_CONSENT_TEXT, AI_CONSENT_VERSION } = await import('../backend/constants/aiConsent.js');

// ── Fake AIServices /internal/llm + the parsed-CV endpoint the CV source asks for ──
const ai = { up: true, calls: [], next: null, enabled: true, deleteFails: false };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const call = { method: req.method, path: url.pathname, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
    ai.calls.push(call);
    if (!ai.up) return req.socket.destroy();
    const json = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
    if (url.pathname.startsWith('/internal/cv')) return json(404, { success: false });
    if (url.pathname === '/internal/llm/status') return json(200, { success: true, data: { enabled: ai.enabled, provider: 'fake' } });
    if (url.pathname === '/internal/llm/user-data' && ai.deleteFails) return json(503, { success: false });
    if (url.pathname === '/internal/llm/user-data') return json(200, { success: true, data: { cache_entries_deleted: 2 } });
    if (ai.next) { const { status, body, headers } = ai.next; ai.next = null; return json(status, body, headers); }
    return json(200, { success: true, data: { suggestion: 'Backend developer skilled in Python.', insufficient_data: false,
      flags: [{ text: 'Kubernetes', reason: 'skill not in your profile', start: 1, end: 11 }], usage: { cached: false } } });
  });
});

let alice;
const sign = (u) => jwt.sign({ userId: String(u._id), id: String(u._id), role: u.role }, process.env.JWT_SECRET);
const as = (r, user = alice) => r.set('Authorization', `Bearer ${sign(user)}`);
const llmCalls = (path) => ai.calls.filter((c) => c.path === path);

beforeAll(async () => {
  await new Promise((r) => server.listen(0, r));
  process.env.AI_SERVICE_URL = `http://localhost:${server.address().port}`;
  process.env.LLM_ASSIST_TIMEOUT_MS = '500';
  await connectTestDb();
  alice = await User.create({ name: 'Ayesha Raza', email: 'ayesha.raza@example.com', password: 'abcd1234' });
  await Profile.create({
    userId: alice._id,
    personalInfo: { phone: '+92 300 1234567', location: 'Islamabad', linkedin: 'https://linkedin.com/in/ayesha',
      github: 'https://github.com/ayesharaza', website: 'https://ayesha.dev' },
    summary: 'Backend developer.',
    experience: [{ title: 'Backend Developer', company: 'Acme Labs', startDate: '2021-01', endDate: '2023-06', description: 'Built APIs.' }],
    education: [{ degree: 'BS', field: 'Computer Science', institution: 'COMSATS University', endDate: '2099-06' },
      { degree: 'FSc', field: 'Pre-Engineering', institution: 'Model College', endDate: '2020' }],
    skills: { manual: ['Python', 'Django'] },
    projects: { manual: [{ name: 'Muqayyim', description: 'Career platform', url: 'https://muqayyim.example.com', technologies: ['React'] }] },
  });
});

afterAll(async () => {
  process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await dropTestDb();
});

beforeEach(async () => {
  Object.assign(ai, { up: true, calls: [], next: null, enabled: true, deleteFails: false });
  await PendingLlmDeletion.deleteMany({});
  await User.updateOne({ _id: alice._id }, { $set: { aiConsent: { granted: false } } });
});

const consent = () => as(request(app).post('/api/ai/consent')).send({ agree: true, version: AI_CONSENT_VERSION });
const assist = (body) => as(request(app).post('/api/ai/cv-assist')).send(body);

describe('consent', () => {
  test('no token → 401', async () => {
    expect((await request(app).get('/api/ai/consent')).status).toBe(401);
    expect((await request(app).post('/api/ai/cv-assist').send({})).status).toBe(401);
  });

  test('the consent state carries the exact free-tier text; agreeing stores it on the user', async () => {
    const before = await as(request(app).get('/api/ai/consent'));
    expect(before.body.data).toMatchObject({ granted: false, text: AI_CONSENT_TEXT, currentVersion: AI_CONSENT_VERSION, provider: 'Google Gemini' });
    expect(before.body.data.text).toBe('Your CV/profile text, and your skills and learning preferences, to build learning paths, are sent to Google Gemini for processing. On the free tier, Google may use this content to improve its products.');
    const given = await consent();
    expect(given.status).toBe(200);
    expect(given.body.data.granted).toBe(true);
    const stored = await User.findById(alice._id).lean();
    expect(stored.aiConsent).toMatchObject({ granted: true, version: AI_CONSENT_VERSION, provider: 'Google Gemini' });
  });

  test('consent must be explicit and for the current text', async () => {
    expect((await as(request(app).post('/api/ai/consent')).send({ version: AI_CONSENT_VERSION })).status).toBe(400);
    const stale = await as(request(app).post('/api/ai/consent')).send({ agree: true, version: '2020-01-01' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONSENT_VERSION_CHANGED');
  });

  test('withdrawing turns AI off and deletes the cached AI outputs in AIServices', async () => {
    await consent();
    const res = await as(request(app).delete('/api/ai/consent'));
    expect(res.status).toBe(200);
    expect(res.body.data.granted).toBe(false);
    await flushLlmDeletes();
    const [call] = llmCalls('/internal/llm/user-data');
    expect(call.method).toBe('DELETE');
    expect(call.headers['x-user-id']).toBe(String(alice._id));
    expect(call.headers['x-internal-key']).toBe(process.env.INTERNAL_API_KEY);
    expect((await assist({ target: 'summary', mode: 'generate' })).body.code).toBe('AI_CONSENT_REQUIRED');
  });

  test('deleting the account (admin) also deletes the cached AI outputs', async () => {
    const admin = await User.create({ name: 'Admin Test', email: 'ai-admin@example.com', password: 'admin1234', role: 'Admin' });
    const bob = await User.create({ name: 'Bob Test', email: 'ai-bob@example.com', password: 'abcd1234' });
    const res = await as(request(app).delete(`/api/admin/users/${bob._id}`), admin);
    expect(res.status).toBe(200);
    await flushLlmDeletes();
    expect(llmCalls('/internal/llm/user-data').map((c) => c.headers['x-user-id'])).toContain(String(bob._id));
  });

  test('status says whether AI is available, without details', async () => {
    expect((await as(request(app).get('/api/ai/status'))).body.data).toEqual({ available: true });
    ai.enabled = false;
    expect((await as(request(app).get('/api/ai/status'))).body.data).toEqual({ available: false });
  });
});

describe('CV assist', () => {
  test('without consent nothing reaches AIServices', async () => {
    const res = await assist({ target: 'summary', mode: 'generate' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AI_CONSENT_REQUIRED');
    expect(res.body.data.text).toBe(AI_CONSENT_TEXT);
    expect(llmCalls('/internal/llm/cv-assist')).toHaveLength(0);
  });

  test('facts come from the stored profile; no name, e-mail, phone, address, links or photo are forwarded', async () => {
    await consent();
    const res = await assist({ target: 'summary', mode: 'generate', currentText: 'Backend developer.' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ suggestion: 'Backend developer skilled in Python.', insufficientData: false,
      flags: [{ text: 'Kubernetes', reason: 'skill not in your profile', start: 1, end: 11 }] });
    const [call] = llmCalls('/internal/llm/cv-assist');
    const body = JSON.parse(call.body);
    expect(call.headers['x-user-id']).toBe(String(alice._id));
    expect(body.context.experience).toEqual([{ title: 'Backend Developer', company: 'Acme Labs', startDate: '2021-01', endDate: '2023-06', current: false, status: 'past' }]);
    // Each education entry says whether it is finished (truthfulness: a student is not a graduate).
    expect(body.context.education).toEqual([
      { degree: 'BS', field: 'Computer Science', institution: 'COMSATS University', status: 'in_progress', expected_year: '2099' },
      { degree: 'FSc', field: 'Pre-Engineering', institution: 'Model College', status: 'completed', expected_year: '' }]);
    expect(body.context.skills).toEqual(expect.arrayContaining(['Python', 'Django']));
    expect(body.context.projects).toEqual([{ name: 'Muqayyim', technologies: ['React'] }]);
    expect(body.redact).toEqual(['Ayesha Raza', 'Ayesha', 'Raza']); // only for scrubbing in AIServices
    const withoutRedact = JSON.stringify({ ...body, redact: undefined });
    for (const item of ['Ayesha', 'Raza', 'ayesha.raza@example.com', '300 1234567', 'Islamabad', 'linkedin.com', 'github.com',
      'ayesha.dev', 'muqayyim.example.com', 'personal', 'email', 'phone']) {
      expect(withoutRedact).not.toContain(item);
    }
  });

  test('the target entry keeps allowed fields only', async () => {
    await consent();
    await assist({ target: 'experience', mode: 'improve', currentText: 'Built APIs.',
      entry: { title: 'Backend Developer', company: 'Acme Labs', startDate: '2021', location: 'Islamabad', email: 'x@y.com', description: 'ignored' } });
    const body = JSON.parse(llmCalls('/internal/llm/cv-assist')[0].body);
    expect(body.entry).toEqual({ title: 'Backend Developer', company: 'Acme Labs', startDate: '2021', endDate: '', current: false, status: 'past' });
    expect(body.current_text).toBe('Built APIs.');
  });

  test('unknown section or action → 400 without calling AI', async () => {
    await consent();
    expect((await assist({ target: 'education', mode: 'generate' })).status).toBe(400);
    expect((await assist({ target: 'summary', mode: 'rewrite' })).status).toBe(400);
    expect(llmCalls('/internal/llm/cv-assist')).toHaveLength(0);
  });

  test.each([
    [429, 'LLM_QUOTA_EXCEEDED', '3600'],
    [429, 'LLM_RATE_LIMITED', '40'],
    [503, 'LLM_UNAVAILABLE', undefined],
    [503, 'LLM_DISABLED', undefined],
    [504, 'LLM_TIMEOUT', undefined],
    [502, 'LLM_INVALID_OUTPUT', undefined],
  ])('AI %s %s is passed through with its retry hint', async (status, code, retry) => {
    await consent();
    ai.next = { status, body: { success: false, code, message: 'Safe message.', ...(retry ? { retry_after_seconds: Number(retry) } : {}) },
      headers: retry ? { 'Retry-After': retry } : {} };
    const res = await assist({ target: 'summary', mode: 'generate' });
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
    if (retry) {
      expect(res.headers['retry-after']).toBe(retry);
      expect(res.body.retryAfterSeconds).toBe(Number(retry));
    }
  });

  test('AI unreachable or an unexpected AI error → 503 LLM_UNAVAILABLE', async () => {
    await consent();
    ai.up = false;
    expect((await assist({ target: 'summary', mode: 'generate' })).body.code).toBe('LLM_UNAVAILABLE');
    ai.up = true;
    ai.next = { status: 500, body: { detail: 'Traceback (most recent call last)' } };
    const res = await assist({ target: 'summary', mode: 'generate' });
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('Traceback');
  });

  test('logs hold a user hash, the target and the status — no content', async () => {
    await consent();
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      await assist({ target: 'summary', mode: 'improve', currentText: 'PRIVATE-SUMMARY-TEXT' });
      const lines = info.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('[CvAssist]'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/user=[0-9a-f]{12} target=summary mode=improve status=200 flags=1/);
      for (const leaked of ['PRIVATE-SUMMARY-TEXT', 'Backend developer skilled', String(alice._id), 'ayesha']) {
        expect(lines[0]).not.toContain(leaked);
      }
    } finally {
      info.mockRestore();
    }
  });
});

describe('education status', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  test.each([
    ['2027-06', 'in_progress', '2027'], ['2027', 'in_progress', '2027'], ['Expected 2027', 'in_progress', '2027'],
    ['Present', 'in_progress', ''], ['2025-06', 'completed', ''], ['2026-09', 'completed', ''], ['', 'unknown', ''],
  ])('end date %j → %s', (endDate, status, year) => {
    expect(educationStatus({ endDate }, now)).toEqual({ status, expected_year: year });
  });

  test('a current job is sent as current', async () => {
    await consent();
    await assist({ target: 'experience', mode: 'generate', entry: { title: 'Intern', company: 'Acme Labs', current: true } });
    expect(JSON.parse(llmCalls('/internal/llm/cv-assist')[0].body).entry).toMatchObject({ current: true, status: 'current' });
  });
});

describe('failed cache deletions: retry list', () => {
  test('a deletion that keeps failing is queued, retried hourly, and removed once it succeeds', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await consent();
      ai.deleteFails = true;
      await as(request(app).delete('/api/ai/consent'));
      await flushLlmDeletes();
      const queued = await PendingLlmDeletion.findOne({ userId: String(alice._id) }).lean();
      expect(queued).toMatchObject({ attempts: 1, lastError: '503' });
      expect(Object.keys(queued).sort()).toEqual(['_id', 'attempts', 'createdAt', 'lastError', 'lastTriedAt', 'userId']);

      expect(await retryPendingLlmDeletes()).toMatchObject({ retried: 1, deleted: 0, failed: 1 }); // still down
      expect((await PendingLlmDeletion.findOne({ userId: String(alice._id) }).lean()).attempts).toBe(2);

      ai.deleteFails = false;
      expect(await retryPendingLlmDeletes()).toMatchObject({ retried: 1, deleted: 1, failed: 0 });
      expect(await PendingLlmDeletion.countDocuments()).toBe(0);
      expect(llmCalls('/internal/llm/user-data').at(-1).headers['x-user-id']).toBe(String(alice._id));
    } finally {
      warn.mockRestore();
    }
  });

  test('a later successful deletion clears the entry; entries past the cache lifetime are dropped', async () => {
    await PendingLlmDeletion.create({ userId: String(alice._id), attempts: 3 });
    await consent();
    await as(request(app).delete('/api/ai/consent'));
    await flushLlmDeletes();
    expect(await PendingLlmDeletion.countDocuments()).toBe(0);

    await PendingLlmDeletion.create({ userId: 'old-user', createdAt: new Date(Date.now() - 9 * 86400000) });
    expect(await retryPendingLlmDeletes()).toMatchObject({ expired: 1, retried: 0 });
    expect(await PendingLlmDeletion.countDocuments()).toBe(0);
  });
});
