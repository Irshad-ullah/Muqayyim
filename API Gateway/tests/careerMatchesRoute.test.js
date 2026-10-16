import http from 'http';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';

// /api/career-matches (Module 5) goes to Core, which calls AIServices /internal/matching/*.
const hits = { core: [], ai: [] };
const stub = (name) =>
  http.createServer((req, res) => {
    hits[name].push({ url: req.url, auth: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ from: name }));
  });
const core = stub('core');
const ai = stub('ai');
let app;

beforeAll(async () => {
  await Promise.all([core, ai].map((s) => new Promise((r) => s.listen(0, r))));
  app = createApp(
    loadConfig({
      ...process.env,
      AUTH_SERVICE_URL: `http://localhost:${core.address().port}`,
      CV_SERVICE_URL: `http://localhost:${ai.address().port}`,
    }),
  );
});

afterAll(() => Promise.all([core, ai].map((s) => new Promise((r) => s.close(r)))));
beforeEach(() => { hits.core = []; hits.ai = []; });

test.each(['/api/career-matches', '/api/career-matches/onet:15-1252.00'])('%s is proxied to Core with the token', async (path) => {
  const res = await request(app).get(path).set('Authorization', 'Bearer t');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ from: 'core' });
  expect(hits.core.at(-1)).toEqual({ url: path, auth: 'Bearer t' });
  expect(hits.ai).toEqual([]);
});

test('the normal 1 MB body limit applies', async () => {
  const res = await request(app).post('/api/career-matches').set('Content-Type', 'application/json')
    .send(JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) }));
  expect(res.status).toBe(413);
  expect(hits.core).toEqual([]);
});

test.each(['/internal/matching/users/abc', '/internal/matching/users/abc/professions/onet:15-1252.00'])(
  '%s stays blocked at the gateway', async (path) => {
    const res = await request(app).get(path).set('X-Internal-Key', 'guess');
    expect(res.status).toBe(404);
    expect([...hits.core, ...hits.ai]).toEqual([]);
  });
