import http from 'http';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb } from './helpers.js';
import './authMocks.js';

// Module 6 Part 4: learning paths in CoreServices — consent (the bumped notice), create (structure + enrichment,
// enrichment order and prerequisites applied), saved without enrichment when the LLM fails, one path per career and
// at most 5, ownership, module status, completion → the skill in the profile as "learning" (pushed to AIServices,
// removed again when undone, never wiped by a profile save), validation and AI error pass-through.
// Part 6: freshness ("Regenerate?"), regenerate keeping progress, feedback on resources, "Suggest another resource".

process.env.EMBEDDING_SYNC_RETRY_DELAYS_MS = '0';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { default: Profile } = await import('../backend/models/Profile.js');
const { default: LearningPath } = await import('../backend/models/LearningPath.js');
const { flushEmbeddingSync } = await import('../backend/services/skillEmbeddingSync.js');
const { AI_CONSENT_VERSION, AI_CONSENT_TEXT } = await import('../backend/constants/aiConsent.js');

const STRUCTURE = {
  profession_id: 'curated:frontend-developer', title: 'Frontend Developer', source: 'curated', source_version: 'curated v1.0.0',
  match_score: 40,
  modules: [
    { key: 'react', skill: 'React', requirement_key: 'react', requirement: 'React / Angular', tier: 'essential', order: 1,
      quick_win: true, hint: { skill: 'Vue.js', similarity: 0.9 }, alternatives: [{ name: 'React', key: 'react' }, { name: 'Angular', key: 'angular' }], prerequisites: [] },
    { key: 'javascript', skill: 'JavaScript', requirement_key: 'javascript', requirement: 'JavaScript', tier: 'essential', order: 2,
      quick_win: false, hint: null, alternatives: [], prerequisites: [] },
    { key: 'jest', skill: 'Jest', requirement_key: 'jest', requirement: 'Jest', tier: 'optional', order: 3,
      quick_win: false, hint: null, alternatives: [], prerequisites: [] },
  ],
  more: { count: 2, skills: ['Git', 'Figma'] },
  snapshot: { skills_hash: 'sh1', dataset_hash: 'dh1', scoring_mode: 'exact', algorithm: 'learning-structure@1' },
};
const recommendation = (title, free = true) => ({ platform: 'YouTube', title, instructor: 'Someone', description: 'd', free,
  search_url: `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`,
  search_label: 'Find on YouTube', label: free ? 'AI recommendation' : 'AI recommendation, check before buying' });
const ENRICHMENT = {
  modules: STRUCTURE.modules.map((m) => ({ key: m.key, skill: m.skill, why: `${m.skill} matters.`, subtopics: ['a', 'b', 'c'],
    project: `A ${m.skill} project.`, hours: { min: 10, max: 20, label: 'estimated' }, recommendations: [recommendation(`${m.skill} course`)] })),
  order: ['javascript', 'react', 'jest'],
  prerequisites: { accepted: [['javascript', 'react']], rejected: [] },
  total_hours: { min: 30, max: 60, label: 'estimated' },
  usage: { cached: false, prompt: 'learning_path@v3', model: 'fake' },
};

const ai = { calls: [], structure: null, enrich: null, state: null, more: null, up: true };
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const call = { method: req.method, path: req.url, headers: req.headers, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null };
    ai.calls.push(call);
    if (!ai.up) return req.socket.destroy();
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/internal/learning/structure') return json(...(ai.structure || [200, { success: true, data: STRUCTURE }]));
    if (req.url === '/internal/llm/learning-enrich') return json(...(ai.enrich || [200, { success: true, data: ENRICHMENT }]));
    if (req.url === '/internal/learning/state') return json(...(ai.state || [200, { success: true, data: { skills_hash: 'sh1', dataset_hash: 'dh1' } }]));
    if (req.url === '/internal/llm/learning-more') {
      return json(...(ai.more || [200, { success: true, data: { recommendations: [recommendation('React course'), recommendation('React deep dive', false)], usage: {} } }]));
    }
    if (req.url.startsWith('/internal/embeddings/users/')) return json(200, { success: true });
    return json(404, { success: false });
  });
});

let alice; let bob;
const sign = (u) => jwt.sign({ userId: String(u._id), id: String(u._id), role: u.role }, process.env.JWT_SECRET);
const as = (r, user = alice) => r.set('Authorization', `Bearer ${sign(user)}`);
const create = (body = {}) => as(request(app).post('/api/learning-paths')).send({ professionId: 'curated:frontend-developer',
  preferences: { cost: 'free', hoursPerWeek: 6 }, ...body });
const consent = (user) => User.updateOne({ _id: user._id }, { $set: { aiConsent: { granted: true, version: AI_CONSENT_VERSION, provider: 'Google Gemini' } } });

beforeAll(async () => {
  await new Promise((r) => server.listen(0, r));
  process.env.AI_SERVICE_URL = `http://localhost:${server.address().port}`;
  await connectTestDb();
  alice = await User.create({ name: 'Alice Test', email: 'lp-alice@example.com', password: 'abcd1234' });
  bob = await User.create({ name: 'Bob Test', email: 'lp-bob@example.com', password: 'abcd1234' });
  await Profile.create({ userId: alice._id, skills: { manual: ['HTML', 'CSS'], cv: ['Vue.js'], extracted: [] } });
});

afterAll(async () => {
  process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await dropTestDb();
});

beforeEach(async () => {
  Object.assign(ai, { calls: [], structure: null, enrich: null, state: null, more: null, up: true });
  await LearningPath.deleteMany({});
  await consent(alice);
});

describe('consent', () => {
  test('the notice now covers learning paths; an older consent is asked again before the first path', async () => {
    expect(AI_CONSENT_TEXT).toContain('your skills and learning preferences, to build learning paths');
    await User.updateOne({ _id: alice._id }, { $set: { 'aiConsent.version': '2026-10-17' } });
    const res = await create();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AI_CONSENT_REQUIRED');
    expect(res.body.data.text).toBe(AI_CONSENT_TEXT);
    expect(ai.calls).toHaveLength(0);
  });
});

describe('create', () => {
  test('structure + enrichment are saved; the enrichment order and prerequisites apply; only skill names are sent', async () => {
    const res = await create({ choices: { react: 'react' } });
    expect(res.status).toBe(201);
    const path = res.body.data;
    expect(path.modules.map((m) => m.skill)).toEqual(['JavaScript', 'React', 'Jest']);
    expect(path.modules.map((m) => m.order)).toEqual([1, 2, 3]);
    expect(path.modules[1]).toMatchObject({ quickWin: true, hint: { skill: 'Vue.js' }, prerequisites: ['javascript'], status: 'not_started' });
    expect(path.modules[0].recommendations[0]).toMatchObject({ searchLabel: 'Find on YouTube', label: 'AI recommendation' });
    expect(path).toMatchObject({ enrichment: { status: 'enriched', prompt: 'learning_path@v3' }, more: { count: 2 },
      totalHours: { min: 30, max: 60 }, progress: { total: 3, completed: 0, percent: 0 } });
    const [structureCall, enrichCall] = ai.calls;
    expect(structureCall.headers['x-user-id']).toBe(String(alice._id));
    expect(structureCall.body).toEqual({ profession_id: 'curated:frontend-developer', choices: { react: 'react' } });
    expect(enrichCall.body).toEqual({ role_title: 'Frontend Developer', modules: STRUCTURE.modules.map((m) => ({ key: m.key, skill: m.skill })),
      user_skills: ['HTML', 'CSS', 'Vue.js'], preferences: { cost: 'free', hours_per_week: 6 } });
  });

  test('an unavailable or rejected enrichment still saves the structure', async () => {
    ai.enrich = [502, { success: false, code: 'LLM_INVALID_OUTPUT', message: 'x' }];
    const failed = await create();
    expect(failed.status).toBe(201);
    expect(failed.body.data.enrichment).toMatchObject({ status: 'failed', code: 'LLM_INVALID_OUTPUT' });
    expect(failed.body.data.modules.map((m) => m.skill)).toEqual(['React', 'JavaScript', 'Jest']);
    await LearningPath.deleteMany({});
    ai.enrich = [503, { success: false, code: 'LLM_DISABLED', message: 'x' }];
    expect((await create()).body.data.enrichment.status).toBe('unavailable');
  });

  test('one path per career, at most 5 paths', async () => {
    expect((await create()).status).toBe(201);
    expect((await create()).body.code).toBe('PATH_EXISTS');
    for (let i = 0; i < 4; i += 1) await LearningPath.create({ userId: alice._id, professionId: `onet:15-00${i}0.00` });
    expect((await create({ professionId: 'curated:backend-developer' })).body.code).toBe('PATH_LIMIT');
  });

  test('validation and AI errors', async () => {
    expect((await create({ professionId: 'other:x' })).status).toBe(400);
    expect((await create({ preferences: { cost: 'cheap' } })).status).toBe(400);
    expect((await create({ preferences: { hoursPerWeek: 0 } })).status).toBe(400);
    expect((await create({ choices: ['x'] })).status).toBe(400);
    ai.structure = [404, { success: false, code: 'PROFESSION_NOT_FOUND', message: 'That career was not found.' }];
    expect((await create()).body.code).toBe('PROFESSION_NOT_FOUND');
    ai.structure = [500, { detail: 'Traceback' }];
    const hidden = await create();
    expect(hidden.status).toBe(503);
    expect(JSON.stringify(hidden.body)).not.toContain('Traceback');
    ai.up = false;
    expect((await create()).body.code).toBe('LEARNING_UNAVAILABLE');
  });
});

describe('reading, ownership and progress', () => {
  test('list and get only the user\'s own paths', async () => {
    const { body } = await create();
    const list = await as(request(app).get('/api/learning-paths'));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ title: 'Frontend Developer', modules: 3, more: 2, progress: { percent: 0 } });
    expect((await as(request(app).get(`/api/learning-paths/${body.data.id}`), bob)).status).toBe(404);
    expect((await as(request(app).delete(`/api/learning-paths/${body.data.id}`), bob)).status).toBe(404);
    expect((await request(app).get('/api/learning-paths')).status).toBe(401);
  });

  test('completing a module adds the skill as a learning skill and refreshes AI; undoing removes it', async () => {
    const { body } = await create();
    const id = body.data.id;
    const started = await as(request(app).patch(`/api/learning-paths/${id}/modules/react`)).send({ status: 'in_progress' });
    expect(started.body.data.progress).toMatchObject({ inProgress: 1, completed: 0 });
    const done = await as(request(app).patch(`/api/learning-paths/${id}/modules/react`)).send({ status: 'completed' });
    expect(done.body.data.progress).toMatchObject({ completed: 1, percent: 33 });
    await flushEmbeddingSync();
    expect((await Profile.findOne({ userId: alice._id }).lean()).skills.learning).toEqual(['React']);
    const push = ai.calls.filter((c) => c.path.startsWith('/internal/embeddings/users/')).at(-1);
    expect(push.body.skills).toContainEqual({ name: 'React', source: 'learning' });

    // A normal profile save never wipes the learning skills.
    await as(request(app).put('/api/profile')).send({ skills: { manual: ['HTML', 'CSS', 'Docker'], cv: ['Vue.js'], extracted: [] } });
    expect((await Profile.findOne({ userId: alice._id }).lean()).skills.learning).toEqual(['React']);

    await as(request(app).patch(`/api/learning-paths/${id}/modules/react`)).send({ status: 'in_progress' });
    await flushEmbeddingSync();
    expect((await Profile.findOne({ userId: alice._id }).lean()).skills.learning).toEqual([]);
  });

  test('a skill the profile already has is not added again; bad status or module', async () => {
    const { body } = await create();
    await Profile.updateOne({ userId: alice._id }, { $set: { 'skills.manual': ['HTML', 'CSS', 'Jest'], 'skills.learning': [] } });
    await as(request(app).patch(`/api/learning-paths/${body.data.id}/modules/jest`)).send({ status: 'completed' });
    expect((await Profile.findOne({ userId: alice._id }).lean()).skills.learning).toEqual([]);
    expect((await as(request(app).patch(`/api/learning-paths/${body.data.id}/modules/jest`)).send({ status: 'done' })).status).toBe(400);
    expect((await as(request(app).patch(`/api/learning-paths/${body.data.id}/modules/nope`)).send({ status: 'completed' })).status).toBe(404);
    expect((await as(request(app).delete(`/api/learning-paths/${body.data.id}`))).status).toBe(200);
  });
});

describe('Part 6: freshness, regenerate, feedback, more', () => {
  const url = (id, rest = '') => `/api/learning-paths/${id}${rest}`;

  test('freshness compares the snapshot with AIServices\' current hashes; unknown when AI is unreachable', async () => {
    const { body } = await create();
    const id = body.data.id;
    expect((await as(request(app).get(url(id, '/freshness')))).body.data)
      .toEqual({ available: true, stale: false, profileChanged: false, dataChanged: false });
    ai.state = [200, { success: true, data: { skills_hash: 'sh2', dataset_hash: 'dh1' } }];
    expect((await as(request(app).get(url(id, '/freshness')))).body.data).toMatchObject({ stale: true, profileChanged: true, dataChanged: false });
    ai.state = [200, { success: true, data: { skills_hash: 'sh1', dataset_hash: 'dh2' } }];
    expect((await as(request(app).get(url(id, '/freshness')))).body.data).toMatchObject({ stale: true, dataChanged: true });
    ai.up = false;
    expect((await as(request(app).get(url(id, '/freshness')))).body.data).toMatchObject({ available: false, stale: false });
    expect((await as(request(app).get(url(id, '/freshness')), bob)).status).toBe(404);
  });

  test('regenerate rebuilds with the saved choices, keeps module progress and feedback, may change preferences', async () => {
    const { body } = await create({ choices: { react: 'react' } });
    const id = body.data.id;
    await as(request(app).patch(url(id, '/modules/javascript'))).send({ status: 'in_progress' });
    await as(request(app).post(url(id, '/modules/react/feedback'))).send({ title: 'React course', vote: 'up' });
    ai.calls = [];
    ai.structure = [200, { success: true, data: { ...STRUCTURE, modules: STRUCTURE.modules.slice(0, 2), match_score: 55,
      snapshot: { ...STRUCTURE.snapshot, skills_hash: 'sh2' } } }];
    ai.enrich = [503, { success: false, code: 'LLM_DISABLED' }];
    const res = await as(request(app).post(url(id, '/regenerate'))).send({ preferences: { cost: 'include_paid' } });
    expect(res.status).toBe(200);
    expect(res.body.data.modules.map((m) => [m.key, m.status])).toEqual([['react', 'not_started'], ['javascript', 'in_progress']]);
    expect(res.body.data).toMatchObject({ id, matchScore: 55, snapshot: { skillsHash: 'sh2' }, preferences: { cost: 'include_paid', hoursPerWeek: 6 },
      feedback: [{ moduleKey: 'react', title: 'React course', vote: 'up' }] });
    expect(ai.calls[0].body).toEqual({ profession_id: 'curated:frontend-developer', choices: { react: 'react' } });
    expect(await LearningPath.countDocuments({ userId: alice._id })).toBe(1);
    await User.updateOne({ _id: alice._id }, { $set: { 'aiConsent.version': '2026-10-17' } });
    expect((await as(request(app).post(url(id, '/regenerate'))).send({})).body.code).toBe('AI_CONSENT_REQUIRED');
  });

  test('a module already completed as a learning skill starts as completed in a new path', async () => {
    await Profile.updateOne({ userId: alice._id }, { $set: { 'skills.learning': ['JavaScript'] } });
    const { body } = await create();
    expect(body.data.modules.find((m) => m.key === 'javascript').status).toBe('completed');
    expect(body.data.progress.completed).toBe(1);
    await Profile.updateOne({ userId: alice._id }, { $set: { 'skills.learning': [] } });
  });

  test('feedback: one vote per resource, changeable and removable; unknown resource or vote rejected', async () => {
    const { body } = await create();
    const id = body.data.id;
    const vote = (v, title = 'React course') => as(request(app).post(url(id, '/modules/react/feedback'))).send({ title, vote: v });
    expect((await vote('up')).body.data.feedback).toMatchObject([{ moduleKey: 'react', title: 'React course', vote: 'up' }]);
    expect((await vote('down')).body.data.feedback).toMatchObject([{ vote: 'down' }]);
    expect((await vote(null)).body.data.feedback).toEqual([]);
    expect((await vote('maybe')).status).toBe(400);
    expect((await vote('up', 'Not shown')).body.code).toBe('RESOURCE_NOT_FOUND');
    expect((await as(request(app).post(url(id, '/modules/nope/feedback'))).send({ title: 'x', vote: 'up' })).body.code).toBe('MODULE_NOT_FOUND');
    expect((await as(request(app).post(url(id, '/modules/react/feedback')), bob).send({ title: 'React course', vote: 'up' })).status).toBe(404);
  });

  test('suggest another resource adds only new titles, sends the shown titles, and handles consent, failure and the cap', async () => {
    const { body } = await create({ preferences: { cost: 'include_paid', hoursPerWeek: 6 } });
    const id = body.data.id;
    const more = () => as(request(app).post(url(id, '/modules/react/more'))).send({});
    const res = await more();
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
    expect(res.body.data.modules.find((m) => m.key === 'react').recommendations.map((r) => r.title)).toEqual(['React course', 'React deep dive']);
    const call = ai.calls.find((c) => c.path === '/internal/llm/learning-more');
    expect(call.body).toEqual({ role_title: 'Frontend Developer', skill: 'React', exclude_titles: ['React course'],
      preferences: { cost: 'include_paid', hours_per_week: 6 } });
    ai.more = [502, { success: false, code: 'LLM_INVALID_OUTPUT' }];
    expect((await more()).body.code).toBe('SUGGESTION_UNAVAILABLE');
    await User.updateOne({ _id: alice._id }, { $set: { 'aiConsent.version': '2026-10-17' } });
    expect((await more()).body.code).toBe('AI_CONSENT_REQUIRED');
    await consent(alice);
    const recs = Array.from({ length: 10 }, (_, i) => ({ platform: 'YouTube', title: `R${i}`, free: true }));
    await LearningPath.updateOne({ _id: id, 'modules.key': 'react' }, { $set: { 'modules.$.recommendations': recs } });
    expect((await more()).body.code).toBe('MORE_LIMIT');
  });
});
