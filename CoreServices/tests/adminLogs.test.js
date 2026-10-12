import http from 'http';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb } from './helpers.js';
import './authMocks.js';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { default: ErrorLog } = await import('../backend/models/ErrorLog.js');
const { default: SecurityEvent } = await import('../backend/models/SecurityEvent.js');
const { default: AdminLog } = await import('../backend/admin/models/AdminLog.js');

// ── Fake AIServices log endpoints ───────────────────────────────────────────
const aiState = { up: true, entries: [], acks: [], lastQuery: null };
const ai = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!aiState.up) return req.socket.destroy();
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) return json(403, {});
  if (url.pathname === '/internal/logs/errors') {
    aiState.lastQuery = Object.fromEntries(url.searchParams);
    const limit = Number(url.searchParams.get('limit'));
    return json(200, { data: aiState.entries.slice(0, limit), total: aiState.entries.length });
  }
  const detail = url.pathname.match(/^\/internal\/logs\/errors\/([^/]+)$/);
  if (detail) {
    const e = aiState.entries.find((x) => x.id === detail[1]);
    return e ? json(200, { data: { ...e, stack: 'Traceback: ai stack' } }) : json(404, {});
  }
  const ack = url.pathname.match(/^\/internal\/logs\/errors\/([^/]+)\/acknowledge$/);
  if (ack && req.method === 'PATCH') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      aiState.acks.push({ id: ack[1], ...JSON.parse(body || '{}') });
      const e = aiState.entries.find((x) => x.id === ack[1]);
      json(e ? 200 : 404, e ? { data: { ...e, acknowledged: true } } : {});
    });
    return undefined;
  }
  if (url.pathname === '/internal/logs/summary') return json(200, { counts: { warning: 4, error: 1, critical: 0 } });
  return json(404, {});
});

let admin;
let adminToken;
let seekerToken;
const sign = (u) => jwt.sign({ userId: String(u._id), id: String(u._id), role: u.role }, process.env.JWT_SECRET);
const asAdmin = (path) => request(app).get(path).set('Authorization', `Bearer ${adminToken}`);
const minutesAgo = (m) => new Date(Date.now() - m * 60000);

beforeAll(async () => {
  await new Promise((r) => ai.listen(0, r));
  process.env.AI_SERVICE_URL = `http://localhost:${ai.address().port}`;
  await connectTestDb();
  await ErrorLog.init();
  admin = await User.create({ name: 'Log Admin', email: 'logs-admin@example.com', password: 'admin1234', role: 'Admin' });
  const seeker = await User.create({ name: 'Seeker', email: 'logs-seeker@example.com', password: 'abcd1234' });
  adminToken = sign(admin);
  seekerToken = sign(seeker);

  await ErrorLog.insertMany([
    { timestamp: minutesAgo(1), level: 'error', service: 'core', module: 'auth', errorType: 'TypeError', message: 'login exploded', requestId: 'core-0001-abcdefgh', stack: 'TypeError: login exploded\n at x' },
    { timestamp: minutesAgo(3), level: 'critical', service: 'core', module: 'database', errorType: 'MongoNetworkError', message: 'db down' },
    { timestamp: minutesAgo(5), level: 'warning', service: 'gateway', module: 'proxy', errorType: 'UPSTREAM_TIMEOUT', message: 'AI slow', acknowledged: true },
    { timestamp: minutesAgo(60 * 30), level: 'error', service: 'core', module: 'profile', errorType: 'Error', message: 'old one' },
  ]);
  aiState.entries = [
    { id: 'a1', timestamp: minutesAgo(2).toISOString(), level: 'warning', service: 'ai', module: 'cv-parsing', errorType: 'EMPTY_TEXT', message: 'empty pdf', acknowledged: false },
    { id: 'a2', timestamp: minutesAgo(4).toISOString(), level: 'error', service: 'ai', module: 'cv-parsing', errorType: 'ValueError', message: 'bad', acknowledged: false },
  ];
  await SecurityEvent.insertMany([
    { timestamp: minutesAgo(1), event: 'Account locked', userId: 'u1', ip: '1.2.3.4', requestId: 'sec-0001-abcd' },
    { timestamp: minutesAgo(2), event: 'Password changed', userId: 'u2', ip: '1.2.3.5' },
  ]);
});

afterAll(async () => {
  await dropTestDb();
  await new Promise((r) => ai.close(r));
});

beforeEach(() => {
  aiState.up = true;
});

describe('access', () => {
  test('non-admin → 403 on every log endpoint', async () => {
    for (const p of ['/api/admin/logs/errors', '/api/admin/logs/security', '/api/admin/logs/summary', '/api/admin/logs/errors/core/x']) {
      expect((await request(app).get(p).set('Authorization', `Bearer ${seekerToken}`)).status).toBe(403);
    }
  });
});

describe('GET /api/admin/logs/errors', () => {
  test('merges Core, Gateway and AI entries newest first, without stacks', async () => {
    const res = await asAdmin('/api/admin/logs/errors');
    expect(res.status).toBe(200);
    expect(res.body.partial).toBe(false);
    expect(res.body.pagination.total).toBe(6);
    expect(res.body.data.map((r) => `${r.service}:${r.errorType}`)).toEqual([
      'core:TypeError',
      'ai:EMPTY_TEXT',
      'core:MongoNetworkError',
      'ai:ValueError',
      'gateway:UPSTREAM_TIMEOUT',
      'core:Error',
    ]);
    expect(res.body.data.every((r) => r.stack === undefined && r.id)).toBe(true);
  });

  test('pagination across the merged list', async () => {
    const p1 = await asAdmin('/api/admin/logs/errors?limit=2&page=1');
    const p2 = await asAdmin('/api/admin/logs/errors?limit=2&page=2');
    expect(p1.body.data.map((r) => r.errorType)).toEqual(['TypeError', 'EMPTY_TEXT']);
    expect(p2.body.data.map((r) => r.errorType)).toEqual(['MongoNetworkError', 'ValueError']);
    expect(p2.body.pagination.pages).toBe(3);
  });

  test('filters: service, level, module, search, acknowledged, date range', async () => {
    const svc = await asAdmin('/api/admin/logs/errors?service=gateway');
    expect(svc.body.data.map((r) => r.service)).toEqual(['gateway']);

    const level = await asAdmin('/api/admin/logs/errors?service=core&level=critical');
    expect(level.body.data.map((r) => r.errorType)).toEqual(['MongoNetworkError']);

    const mod = await asAdmin('/api/admin/logs/errors?service=core&module=auth');
    expect(mod.body.data).toHaveLength(1);

    const search = await asAdmin('/api/admin/logs/errors?service=core&search=core-0001');
    expect(search.body.data.map((r) => r.requestId)).toEqual(['core-0001-abcdefgh']);

    const unack = await asAdmin('/api/admin/logs/errors?service=gateway&acknowledged=false');
    expect(unack.body.data).toHaveLength(0);

    const from = minutesAgo(60).toISOString();
    const recent = await asAdmin(`/api/admin/logs/errors?service=core&from=${encodeURIComponent(from)}`);
    expect(recent.body.data.map((r) => r.message)).not.toContain('old one');

    // AI receives the same filters
    await asAdmin('/api/admin/logs/errors?level=warning&module=cv-parsing&search=pdf&acknowledged=false');
    expect(aiState.lastQuery).toMatchObject({ level: 'warning', module: 'cv-parsing', search: 'pdf', acknowledged: 'false' });

    const aiOnly = await asAdmin('/api/admin/logs/errors?service=ai');
    expect(aiOnly.body.data.every((r) => r.service === 'ai')).toBe(true);
  });

  test('limit is capped at 100', async () => {
    const res = await asAdmin('/api/admin/logs/errors?limit=5000');
    expect(res.body.pagination.limit).toBe(100);
  });

  test('AI down → Core results with partial: true and a notice', async () => {
    aiState.up = false;
    const res = await asAdmin('/api/admin/logs/errors');
    expect(res.status).toBe(200);
    expect(res.body.partial).toBe(true);
    expect(res.body.notice).toMatch(/AIServices logs are unavailable/);
    expect(res.body.data.every((r) => r.service !== 'ai')).toBe(true);
    expect(res.body.data).toHaveLength(4);
    const { waitFor } = await import('./logHelpers.js');
    const warning = await waitFor(() => ErrorLog.findOne({ module: 'internal-client' }).lean());
    expect(warning).toMatchObject({ level: 'warning', service: 'core', path: '/api/admin/logs/errors' });
    expect(warning.message).toMatch(/AIServices error-log list failed/);
  });
});

describe('detail and acknowledge', () => {
  test('detail includes the stack (Core and AI)', async () => {
    const core = await ErrorLog.findOne({ errorType: 'TypeError' });
    const res = await asAdmin(`/api/admin/logs/errors/core/${core._id}`);
    expect(res.body.data.stack).toMatch(/TypeError: login exploded/);
    const aiRes = await asAdmin('/api/admin/logs/errors/ai/a1');
    expect(aiRes.body.data).toMatchObject({ id: 'a1', service: 'ai', stack: 'Traceback: ai stack' });
    expect((await asAdmin('/api/admin/logs/errors/core/507f1f77bcf86cd799439011')).status).toBe(404);
    expect((await asAdmin('/api/admin/logs/errors/gateway/' + core._id)).status).toBe(404); // wrong service
  });

  test('acknowledge marks the entry and writes an AdminLog entry', async () => {
    const core = await ErrorLog.findOne({ errorType: 'MongoNetworkError' });
    const res = await request(app)
      .patch(`/api/admin/logs/errors/core/${core._id}/acknowledge`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.acknowledged).toBe(true);
    const fresh = await ErrorLog.findById(core._id);
    expect(fresh.acknowledged).toBe(true);
    expect(fresh.acknowledgedBy).toBe(String(admin._id));
    expect(fresh.acknowledgedAt).toBeInstanceOf(Date);
    const log = await AdminLog.findOne({ action: 'ACK_ERROR_LOG', resourceId: String(core._id) });
    expect(log.details).toEqual({ service: 'core' });

    const aiAck = await request(app).patch('/api/admin/logs/errors/ai/a2/acknowledge').set('Authorization', `Bearer ${adminToken}`);
    expect(aiAck.status).toBe(200);
    expect(aiState.acks.at(-1)).toEqual({ id: 'a2', acknowledgedBy: String(admin._id) });
    expect(await AdminLog.countDocuments({ action: 'ACK_ERROR_LOG' })).toBe(2);
  });
});

describe('security events and summary', () => {
  test('security events are paginated and filterable', async () => {
    const all = await asAdmin('/api/admin/logs/security');
    expect(all.body.data.map((e) => e.event)).toEqual(['Account locked', 'Password changed']);
    expect(all.body.events).toEqual(['Account locked', 'Password changed']);
    const filtered = await asAdmin('/api/admin/logs/security?event=Password%20changed');
    expect(filtered.body.data).toHaveLength(1);
    const byUser = await asAdmin('/api/admin/logs/security?userId=u1');
    expect(byUser.body.data[0].requestId).toBe('sec-0001-abcd');
  });

  test('summary counts the last 24h by service and level (AI via internal call)', async () => {
    const res = await asAdmin('/api/admin/logs/summary');
    // The "AI down" test above made Core log one internal-client warning.
    const aiDownWarnings = await ErrorLog.countDocuments({ service: 'core', level: 'warning', module: 'internal-client' });
    expect(aiDownWarnings).toBe(1);
    expect(res.body.byService.core).toEqual({ warning: 1, error: 1, critical: 1 }); // 30-hour-old entry excluded
    expect(res.body.byService.gateway).toEqual({ warning: 1, error: 0, critical: 0 });
    expect(res.body.byService.ai).toEqual({ warning: 4, error: 1, critical: 0 });
    expect(res.body.totals).toEqual({ warning: 6, error: 2, critical: 1 });
    expect(res.body.partial).toBe(false);

    aiState.up = false;
    const partial = await asAdmin('/api/admin/logs/summary');
    expect(partial.body.partial).toBe(true);
    expect(partial.body.byService.ai).toEqual({ warning: 0, error: 0, critical: 0 });
  });
});
