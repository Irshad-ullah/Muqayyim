import request from 'supertest';
import { INTERNAL_KEY, connectTestDb, dropTestDb } from './helpers.js';
import { waitFor } from './logHelpers.js';
import './authMocks.js';

const { default: app } = await import('../app.js');
const { default: ErrorLog } = await import('../backend/models/ErrorLog.js');

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxIn0.c2lnbmF0dXJlLXNpZ24';
const post = (body, key = INTERNAL_KEY) => {
  const r = request(app).post('/internal/logs');
  if (key) r.set('X-Internal-Key', key);
  return r.send(body);
};
const entry = (i = 0, extra = {}) => ({
  level: 'error',
  module: 'proxy',
  errorType: 'UPSTREAM_UNAVAILABLE',
  message: `Core Service unreachable #${i}`,
  requestId: `gw-ingest-${String(i).padStart(4, '0')}-abcd`,
  method: 'GET',
  path: '/api/profile',
  statusCode: 502,
  ...extra,
});

beforeAll(connectTestDb);
afterAll(dropTestDb);

describe('POST /internal/logs', () => {
  test('no key → 401, wrong key → 403', async () => {
    expect((await post(entry(), null)).status).toBe(401);
    expect((await post(entry(), 'wrong')).status).toBe(403);
  });

  test('more than 50 entries → 400; invalid level → 400', async () => {
    const many = Array.from({ length: 51 }, (_, i) => entry(i));
    const res = await post(many);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOO_MANY_ENTRIES');
    expect((await post(entry(1, { level: 'debug' }))).status).toBe(400);
    expect((await post([])).status).toBe(400);
  });

  test('accepts one entry or a batch, stored as service "gateway"', async () => {
    expect((await post(entry(100))).status).toBe(202);
    const batch = Array.from({ length: 50 }, (_, i) => entry(200 + i));
    const res = await post(batch);
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(50);
    expect(await ErrorLog.countDocuments({ service: 'gateway' })).toBe(51);
  });

  test('stored entries are masked and limited to known fields', async () => {
    await post(
      entry(300, {
        service: 'core', // ignored: always stored as gateway
        message: `token=abc123 jwt ${JWT} password: hunter2`,
        stack: `Error: x\n    at Bearer ${JWT}`,
        body: { password: 'hunter2' },
        headers: { authorization: 'Bearer x' },
        path: '/api/auth/login?password=hunter2',
      }),
    );
    const doc = await waitFor(() => ErrorLog.findOne({ requestId: 'gw-ingest-0300-abcd' }).lean());
    expect(doc.service).toBe('gateway');
    expect(doc.message).not.toMatch(/abc123|hunter2|eyJ/);
    expect(doc.stack).not.toMatch(/eyJ/);
    expect(doc.path).toBe('/api/auth/login');
    expect(doc.body).toBeUndefined();
    expect(doc.headers).toBeUndefined();
  });
});
