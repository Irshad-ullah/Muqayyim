import http from 'http';
import net from 'net';
import request from 'supertest';
import { startStub, useTargets } from './stub.js';

const MB = 1024 * 1024;
let stub;
let app;

beforeAll(async () => {
  stub = await startStub();
  useTargets(stub.url);
  process.env.RATE_LIMIT_ENABLED = 'false';
  process.env.GATEWAY_PROXY_TIMEOUT_MS = '300';
  process.env.GATEWAY_UPLOAD_TIMEOUT_MS = '600';
  ({ default: app } = await import('../app.js'));
});

afterAll(() => stub.close());

describe('request size limits (Content-Length)', () => {
  test('7 MB CV upload → 413 PAYLOAD_TOO_LARGE, not forwarded', async () => {
    const before = stub.hits.length;
    const res = await request(app).post('/api/cv/upload').set('Content-Type', 'application/octet-stream').send(Buffer.alloc(7 * MB));
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ success: false, code: 'PAYLOAD_TOO_LARGE' });
    expect(res.body.message).toMatch(/5 MB/);
    expect(stub.hits.length).toBe(before);
  });

  test('2 MB body on /api/profile → 413', async () => {
    // A real 2 MB JSON document (superagent would re-serialise a Buffer as JSON).
    const body = `{"summary":"${'a'.repeat(2 * MB)}"}`;
    const res = await request(app).put('/api/profile').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('4 MB CV upload → forwarded intact (streamed, not parsed)', async () => {
    const res = await request(app).post('/api/cv/upload').set('Content-Type', 'application/octet-stream').send(Buffer.alloc(4 * MB));
    expect(res.status).toBe(200);
    expect(stub.hits.at(-1)).toMatchObject({ url: '/api/cv/upload', size: 4 * MB });
  });

  test('absurd declared size → 413 immediately with Connection: close (body never read)', async () => {
    const server = app.listen(0);
    const { port } = server.address();
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { port, method: 'POST', path: '/api/cv/upload', headers: { 'Content-Length': String(500 * MB), 'Content-Type': 'application/octet-stream' } },
        (r) => {
          let data = '';
          r.on('data', (c) => { data += c; });
          r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: JSON.parse(data) }));
        },
      );
      req.on('error', reject);
      req.write(Buffer.alloc(1024)); // only 1 KB of the declared 500 MB
    });
    server.close();
    expect(res.status).toBe(413);
    expect(res.headers.connection).toBe('close');
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('small JSON bodies pass through untouched', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x' });
    expect(res.status).toBe(200);
  });
});

describe('upstream failures → clean JSON', () => {
  test('target that never responds → 504 UPSTREAM_TIMEOUT within the configured timeout', async () => {
    const start = Date.now();
    const res = await request(app).get('/api/profile/hang');
    const elapsed = Date.now() - start;
    expect(res.status).toBe(504);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ success: false, code: 'UPSTREAM_TIMEOUT' });
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(3000);
  });

  test('uploads get the longer timeout', async () => {
    const start = Date.now();
    const res = await request(app).post('/api/cv/hang').send({});
    expect(res.status).toBe(504);
    const uploadStart = Date.now();
    const up = await request(app).post('/api/cv/upload/hang').send({});
    // /api/cv/upload/hang is not the upload path itself → normal timeout
    expect(up.status).toBe(504);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(Date.now() - uploadStart).toBeLessThan(3000);
  });

  test('target down → 502 UPSTREAM_UNAVAILABLE', async () => {
    // Find a free port with nothing listening on it.
    const port = await new Promise((resolve) => {
      const srv = net.createServer().listen(0, () => {
        const p = srv.address().port;
        srv.close(() => resolve(p));
      });
    });
    const { createApp } = await import('../app.js');
    const { loadConfig } = await import('../config.js');
    const downApp = createApp({ ...loadConfig(), authServiceUrl: `http://localhost:${port}` });

    const res = await request(downApp).get('/api/profile');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      success: false,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Core Service is temporarily unavailable. Please try again.',
    });
  });
});
