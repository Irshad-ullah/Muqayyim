import http from 'http';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';

// /api/embeddings/* (Module 2 FE-4/FE-5) goes to AIServices, not Core.
const hits = { core: [], ai: [] };
const stub = (name) =>
  http.createServer((req, res) => {
    hits[name].push(req.url);
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

test.each(['/api/embeddings/me', '/api/embeddings/me/map', '/api/embeddings/health'])('%s is proxied to AIServices', async (path) => {
  const res = await request(app).get(path).set('Authorization', 'Bearer x');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ from: 'ai' });
  expect(hits.ai.at(-1)).toBe(path);
  expect(hits.core).toEqual([]);
});

test('internal embedding endpoints stay blocked at the gateway', async () => {
  const res = await request(app).put('/internal/embeddings/users/abc').send({ skills: [] });
  expect(res.status).toBe(404);
  expect(hits.ai).not.toContain('/internal/embeddings/users/abc');
});
