import { jest } from '@jest/globals';
import http from 'http';
import net from 'net';
import request from 'supertest';
import { startStub } from './stub.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createErrorReporter } from '../services/errorReporter.js';
import { createSpikeDetector } from '../services/rateLimitSpike.js';
import express from 'express';
import { requestId } from '../middleware/requestId.js';
import { createErrorHandler } from '../middleware/errorHandler.js';

const KEY = 'gw-test-internal-key';

// Fake CoreServices log endpoint: records every POST /internal/logs.
const startCoreLogs = async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ path: req.url, key: req.headers['x-internal-key'], entries: JSON.parse(body || '[]') });
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end('{"success":true}');
    });
  });
  await new Promise((r) => server.listen(0, r));
  return {
    url: `http://localhost:${server.address().port}`,
    received,
    entries: () => received.flatMap((r) => r.entries),
    close: () => new Promise((r) => server.close(r)),
  };
};

const waitUntil = async (cond, timeout = 3000) => {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeout) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer().listen(0, () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });

let core;
let stub;

beforeAll(async () => {
  core = await startCoreLogs();
  stub = await startStub();
});

afterAll(async () => {
  await core.close();
  await stub.close();
});

beforeEach(() => {
  core.received.length = 0;
});

const baseConfig = (extra = {}) => ({
  ...loadConfig({ RATE_LIMIT_ENABLED: 'false' }),
  authServiceUrl: stub.url,
  cvServiceUrl: stub.url,
  ...extra,
});

describe('502 / 504 are reported to Core', () => {
  test('target down → 502 and one entry POSTed to /internal/logs with the internal key', async () => {
    const reporter = createErrorReporter({ coreUrl: core.url, internalKey: KEY, flushMs: 10 });
    const app = createApp(baseConfig({ authServiceUrl: `http://localhost:${await freePort()}` }), { errorReporter: reporter });

    const res = await request(app).get('/api/profile?x=1').set('X-Request-Id', 'gw-down-0001-abcd');
    expect(res.status).toBe(502);
    await waitUntil(async () => {
      await reporter.flush();
      return core.entries().length > 0;
    });

    expect(core.received[0].path).toBe('/internal/logs');
    expect(core.received[0].key).toBe(KEY);
    expect(core.entries()).toEqual([
      expect.objectContaining({
        level: 'error',
        module: 'proxy',
        errorType: 'UPSTREAM_UNAVAILABLE',
        requestId: 'gw-down-0001-abcd',
        method: 'GET',
        path: '/api/profile',
        statusCode: 502,
      }),
    ]);
  });

  test('target timeout → 504 and an UPSTREAM_TIMEOUT entry', async () => {
    const reporter = createErrorReporter({ coreUrl: core.url, internalKey: KEY, flushMs: 10 });
    const app = createApp(baseConfig({ proxyTimeoutMs: 200 }), { errorReporter: reporter });
    const res = await request(app).get('/api/profile/hang').set('X-Request-Id', 'gw-slow-0001-abcd');
    expect(res.status).toBe(504);
    await waitUntil(async () => {
      await reporter.flush();
      return core.entries().length > 0;
    });
    expect(core.entries()).toEqual([
      expect.objectContaining({ errorType: 'UPSTREAM_TIMEOUT', statusCode: 504, requestId: 'gw-slow-0001-abcd' }),
    ]);
  });

  test('unhandled gateway errors → JSON 500 with a reference and a reported entry', async () => {
    const reporter = createErrorReporter({ coreUrl: core.url, internalKey: KEY, flushMs: 10 });
    const mini = express();
    mini.use(requestId);
    mini.get('/api/explode', () => {
      throw new RangeError('gateway bug');
    });
    mini.use(createErrorHandler(reporter));

    const res = await request(mini).get('/api/explode?q=1').set('X-Request-Id', 'gw-err-0001-abcd');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Reference: gw-err-0001-abcd',
      requestId: 'gw-err-0001-abcd',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/RangeError|gateway bug/);
    await reporter.flush();
    expect(core.entries()[0]).toMatchObject({
      level: 'error',
      module: 'gateway',
      errorType: 'RangeError',
      message: 'gateway bug',
      requestId: 'gw-err-0001-abcd',
      path: '/api/explode',
      statusCode: 500,
    });
  });
});

describe('error reporter', () => {
  test('batches entries (≤ batch size per request)', async () => {
    const reporter = createErrorReporter({ coreUrl: core.url, internalKey: KEY, batchSize: 20, flushMs: 5 });
    for (let i = 0; i < 25; i++) reporter.report({ level: 'error', module: 't', message: `m${i}` });
    await waitUntil(async () => {
      await reporter.flush();
      return core.entries().length === 25;
    });
    // Two requests (20 + 5); arrival order is not guaranteed.
    expect(core.received.map((r) => r.entries.length).sort((a, b) => a - b)).toEqual([5, 20]);
  });

  test('Core unreachable → console only, never throws', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const reporter = createErrorReporter({ coreUrl: `http://localhost:${await freePort()}`, internalKey: KEY, flushMs: 5 });
    reporter.report({ level: 'error', module: 't', message: 'lost' });
    await reporter.flush();
    expect(err.mock.calls.some((c) => String(c[0]).startsWith('[ErrorLog:core-unreachable'))).toBe(true);
    expect(err.mock.calls.join(' ')).not.toContain(KEY);
    err.mockRestore();
  });
});

describe('rate-limit spikes', () => {
  test('one IP hitting limits more than 20 times in 10 minutes → exactly one RATE_LIMIT_SPIKE warning', async () => {
    const reporter = createErrorReporter({ coreUrl: core.url, internalKey: KEY, flushMs: 10 });
    const config = loadConfig({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_LOGIN_MAX: '1' });
    const app = createApp({ ...config, authServiceUrl: stub.url, cvServiceUrl: stub.url }, { errorReporter: reporter });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    for (let i = 0; i < 30; i++) {
      await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.77').set('x-stub-status', '401').send({});
    }
    // A different IP below the threshold
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.78').set('x-stub-status', '401').send({});
    }
    await reporter.flush();
    warn.mockRestore();

    const spikes = core.entries().filter((e) => e.errorType === 'RATE_LIMIT_SPIKE');
    expect(spikes).toHaveLength(1);
    expect(spikes[0]).toMatchObject({ level: 'warning', module: 'rate-limit' });
    expect(spikes[0].message).toContain('203.0.113.77');
  });

  test('detector re-arms after the window', () => {
    let t = 0;
    const onSpike = jest.fn();
    const d = createSpikeDetector({ threshold: 3, windowMs: 1000, onSpike, now: () => t });
    for (let i = 0; i < 10; i++) d.record('1.1.1.1');
    expect(onSpike).toHaveBeenCalledTimes(1);
    t = 2000;
    for (let i = 0; i < 4; i++) d.record('1.1.1.1');
    expect(onSpike).toHaveBeenCalledTimes(2);
  });
});
