import http from 'http';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb, INTERNAL_KEY } from './helpers.js';
import { waitFor } from './logHelpers.js';
import './authMocks.js';

// Skill embeddings (FR-B9): every profile write that changes the merged skill
// set pushes it to AIServices in the background; nothing else calls AI.

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { default: ErrorLog } = await import('../backend/models/ErrorLog.js');
const { flushEmbeddingSync, mergedSkills, skillsHash } = await import('../backend/services/skillEmbeddingSync.js');

// Stub AIServices: records requests; `failWith` makes it answer with an error.
const calls = [];
let failWith = 0;
const ai = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, key: req.headers['x-internal-key'], body: body ? JSON.parse(body) : null });
    res.writeHead(failWith || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: !failWith }));
  });
});

let user;
let token;
let n = 0;
const put = (body) => request(app).put('/api/profile').set('Authorization', `Bearer ${token}`).send(body);
const embedCalls = () => calls.filter((c) => c.url.startsWith('/internal/embeddings/'));

beforeAll(async () => {
  await connectTestDb();
  await new Promise((r) => ai.listen(0, r));
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${ai.address().port}`;
});

beforeEach(async () => {
  calls.length = 0;
  failWith = 0;
  user = await User.create({ name: 'Embed Sync', email: `emb${Date.now()}_${n++}@example.com`, password: 'abcd1234' });
  token = jwt.sign({ userId: String(user._id), id: String(user._id), role: 'JobSeeker' }, process.env.JWT_SECRET);
});

afterAll(async () => {
  await new Promise((r) => ai.close(r));
  process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
  await dropTestDb();
});

describe('merged skills and hash', () => {
  test('merge order manual → cv → github, first spelling wins, extracted = github', () => {
    const profile = { skills: { manual: ['React', ' python '], cv: ['react', 'Docker'], extracted: ['docker', 'Go'] } };
    expect(mergedSkills(profile)).toEqual([
      { name: 'React', source: 'manual' },
      { name: 'python', source: 'manual' },
      { name: 'Docker', source: 'cv' },
      { name: 'Go', source: 'github' },
    ]);
  });

  test('hash ignores case, whitespace, order and source', () => {
    const a = { skills: { manual: ['React', 'Go'] } };
    const b = { skills: { cv: [' go '], extracted: ['REACT'] } };
    expect(skillsHash(a)).toBe(skillsHash(b));
    expect(skillsHash(a)).not.toBe(skillsHash({ skills: { manual: ['React'] } }));
  });
});

describe('profile writes notify AIServices only when skills change', () => {
  test('Profile Builder save → PUT with the merged skills and their sources', async () => {
    const res = await put({ skills: { manual: ['React', 'Node.js'], cv: ['Python'], extracted: ['Docker'] } });
    expect(res.status).toBe(200);
    await flushEmbeddingSync();
    const [call] = embedCalls();
    expect(call.method).toBe('PUT');
    expect(call.url).toBe(`/internal/embeddings/users/${user._id}`);
    expect(call.key).toBe(INTERNAL_KEY);
    expect(call.body.skills).toEqual([
      { name: 'React', source: 'manual' },
      { name: 'Node.js', source: 'manual' },
      { name: 'Python', source: 'cv' },
      { name: 'Docker', source: 'github' },
    ]);
    expect(typeof call.body.requestedAt).toBe('number');
  });

  test('CV import apply (skills.cv) and GitHub import apply (skills.extracted) notify', async () => {
    await put({ skills: { manual: [], cv: ['Python', 'Django'], extracted: [] }, cvImportedAt: new Date().toISOString() });
    await put({
      skills: { manual: [], cv: ['Python', 'Django'], extracted: ['Go'] },
      githubData: { username: 'octo-cat', repos: [], extractedSkills: ['Go'] },
    });
    await flushEmbeddingSync();
    const [cvImport, githubImport] = embedCalls();
    expect(cvImport.body.skills.map((s) => s.source)).toEqual(['cv', 'cv']);
    expect(githubImport.body.skills).toContainEqual({ name: 'Go', source: 'github' });
  });

  test('summary-only saves and unchanged skills never call AI', async () => {
    await put({ skills: { manual: ['React'] } });
    await flushEmbeddingSync();
    calls.length = 0;
    await put({ summary: 'Only the summary changed' });
    await put({ skills: { manual: [], cv: ['react'] } }); // same key set, other source/case
    await put({ experience: [] });
    await flushEmbeddingSync();
    expect(embedCalls()).toHaveLength(0);
  });

  test('the skill merge endpoint itself writes nothing; the following save notifies', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const merged = await request(app).post('/api/profile/extract-skills').set(auth).send({ cvSkills: ['Go'], manualSkills: ['React'] });
    await flushEmbeddingSync();
    expect(embedCalls()).toHaveLength(0);
    await put({ skills: { manual: merged.body.skills, cv: [], extracted: [] } });
    await flushEmbeddingSync();
    expect(embedCalls()).toHaveLength(1);
  });

  test('pushes for one user arrive in order (latest last)', async () => {
    await put({ skills: { manual: ['A1'] } });
    await put({ skills: { manual: ['A1', 'B2'] } });
    await put({ skills: { manual: ['A1', 'B2', 'C3'] } });
    await flushEmbeddingSync();
    const lists = embedCalls().map((c) => c.body.skills.length);
    expect(lists).toEqual([1, 2, 3]);
    const stamps = embedCalls().map((c) => c.body.requestedAt);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
  });

  test('AIServices down → retried, warning logged, and the save still succeeds', async () => {
    failWith = 503;
    const res = await put({ skills: { manual: ['Rust'] } });
    expect(res.status).toBe(200);
    expect(res.body.profile.skills.manual).toEqual(['Rust']);
    await flushEmbeddingSync();
    expect(embedCalls()).toHaveLength(3); // EMBEDDING_SYNC_RETRY_DELAYS_MS has 3 attempts
    const entry = await waitFor(() => ErrorLog.findOne({ module: 'embeddings-sync', userId: String(user._id) }).lean());
    expect(entry).toMatchObject({ level: 'warning', errorType: 'AI_HTTP_503' });
  });

  test('AIServices unreachable → the save still succeeds', async () => {
    process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
    try {
      const res = await put({ skills: { manual: ['Elixir'] } });
      expect(res.status).toBe(200);
      await flushEmbeddingSync();
      const entry = await waitFor(() => ErrorLog.findOne({ module: 'embeddings-sync', userId: String(user._id) }).lean());
      expect(entry.level).toBe('warning');
    } finally {
      process.env.AI_SERVICE_URL = `http://127.0.0.1:${ai.address().port}`;
    }
  });
});

describe('account deletion', () => {
  test('admin deleting a user → DELETE /internal/embeddings/users/:id', async () => {
    const admin = await User.create({ name: 'Admin', email: `adm${Date.now()}@example.com`, password: 'admin1234', role: 'Admin' });
    const adminToken = jwt.sign({ userId: String(admin._id), id: String(admin._id), role: 'Admin' }, process.env.JWT_SECRET);
    const res = await request(app).delete(`/api/admin/users/${user._id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    await flushEmbeddingSync();
    expect(embedCalls()).toEqual([
      expect.objectContaining({ method: 'DELETE', url: `/internal/embeddings/users/${user._id}`, key: INTERNAL_KEY }),
    ]);
  });
});
