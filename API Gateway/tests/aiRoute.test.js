import http from 'http';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';

// /api/ai (12: consent, CV assist) goes to Core, which calls AIServices /internal/llm/*.
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

test.each([['get', '/api/ai/status'], ['get', '/api/ai/consent'], ['post', '/api/ai/consent'], ['delete', '/api/ai/consent'],
  ['post', '/api/ai/cv-assist']])('%s %s is proxied to Core with the token', async (method, path) => {
  const res = await request(app)[method](path).set('Authorization', 'Bearer t').send({});
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ from: 'core' });
  expect(hits.core.at(-1)).toEqual({ url: path, auth: 'Bearer t' });
  expect(hits.ai).toEqual([]);
});

test('the normal 1 MB body limit applies to CV assist', async () => {
  const res = await request(app).post('/api/ai/cv-assist').set('Content-Type', 'application/json')
    .send(JSON.stringify({ currentText: 'x'.repeat(2 * 1024 * 1024) }));
  expect(res.status).toBe(413);
  expect(hits.core).toEqual([]);
});

test.each(['/internal/llm/status', '/internal/llm/cv-assist', '/internal/llm/user-data'])('%s stays blocked at the gateway', async (path) => {
  const res = await request(app).get(path).set('X-Internal-Key', 'guess');
  expect(res.status).toBe(404);
  expect([...hits.core, ...hits.ai]).toEqual([]);
});

// Module 6: /api/learning-paths goes to Core, which calls AIServices /internal/learning/* and /internal/llm/learning-*.
test.each([['get', '/api/learning-paths'], ['post', '/api/learning-paths'], ['get', '/api/learning-paths/abc'],
  ['patch', '/api/learning-paths/abc/modules/react'], ['delete', '/api/learning-paths/abc']])(
  '%s %s is proxied to Core with the token', async (method, path) => {
    const res = await request(app)[method](path).set('Authorization', 'Bearer t').send({});
    expect(res.status).toBe(200);
    expect(hits.core.at(-1)).toEqual({ url: path, auth: 'Bearer t' });
    expect(hits.ai).toEqual([]);
  });

test('/internal/learning/* is not reachable through the gateway', async () => {
  const res = await request(app).post('/internal/learning/structure').send({});
  expect(res.status).toBe(404);
  expect(hits.core).toEqual([]);
  expect(hits.ai).toEqual([]);
});
