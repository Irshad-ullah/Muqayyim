import { jest } from '@jest/globals';
import request from 'supertest';
import { connectTestDb, dropTestDb } from './helpers.js';
import './authMocks.js';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeAll(connectTestDb);
afterAll(dropTestDb);

describe('X-Request-Id', () => {
  test('echoes the id sent by the gateway', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'gw-req-1234-abcd');
    expect(res.headers['x-request-id']).toBe('gw-req-1234-abcd');
  });

  test('generates one when missing or invalid', async () => {
    expect((await request(app).get('/health')).headers['x-request-id']).toMatch(UUID_V4);
    expect((await request(app).get('/health').set('X-Request-Id', 'bad id!')).headers['x-request-id']).toMatch(UUID_V4);
  });

  test('echoed on API error responses and included in security log lines', async () => {
    const email = `rid${Date.now()}@example.com`;
    await User.create({ name: 'Rid', email, password: 'abcd1234' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    let last;
    for (let i = 0; i < 5; i++) {
      last = await request(app)
        .post('/api/auth/login')
        .set('X-Request-Id', `lock-req-000${i}`)
        .send({ email, password: 'wrong-pass1' });
    }
    expect(last.status).toBe(423);
    expect(last.headers['x-request-id']).toBe('lock-req-0004');

    const line = warn.mock.calls.find((c) => String(c[0]).includes('[Security] Account locked'));
    expect(JSON.parse(line[1]).requestId).toBe('lock-req-0004');
    warn.mockRestore();
  });
});
