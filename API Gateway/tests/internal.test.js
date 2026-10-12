import http from 'http';
import request from 'supertest';

// Point both upstreams at a stub that records any request it receives, so we
// can prove /internal never leaves the gateway.
const hits = [];
const upstream = http.createServer((req, res) => {
  hits.push(req.url);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ upstream: true }));
});

let app;

beforeAll(async () => {
  await new Promise((resolve) => upstream.listen(0, resolve));
  const url = `http://localhost:${upstream.address().port}`;
  process.env.AUTH_SERVICE_URL = url;
  process.env.CV_SERVICE_URL = url;
  ({ default: app } = await import('../app.js'));
});

afterAll(() => new Promise((resolve) => upstream.close(resolve)));

beforeEach(() => {
  hits.length = 0;
});

describe('gateway /internal blocking', () => {
  test.each([
    ['GET', '/internal/anything'],
    ['PUT', '/internal/users/507f1f77bcf86cd799439011/cv-status'],
    ['GET', '/internal/cv/507f1f77bcf86cd799439011/latest'],
  ])('%s %s → 404 and not proxied', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path)
      .set('X-Internal-Key', 'anything')
      .send({ status: 'verified' });
    expect(res.status).toBe(404);
    expect(hits).toEqual([]);
  });

  test('normal API routes are still proxied', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(200);
    expect(res.body.upstream).toBe(true);
    expect(hits).toEqual(['/api/profile']);
  });
});
