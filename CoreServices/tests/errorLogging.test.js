import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb } from './helpers.js';
import { waitFor } from './logHelpers.js';
import './authMocks.js';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { default: Profile } = await import('../backend/models/Profile.js');
const { default: ErrorLog } = await import('../backend/models/ErrorLog.js');
const { default: requestId } = await import('../backend/middleware/requestId.js');
const { default: errorHandler } = await import('../backend/middleware/errorHandler.js');
const { ensureTtlIndex } = await import('../backend/config/logging.js');
const mongoose = (await import('mongoose')).default;

const JWT_IN_MESSAGE = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxIn0.c2lnbmF0dXJlLXNpZ24';
let user;
let token;

beforeAll(async () => {
  await connectTestDb();
  await ErrorLog.init();
  user = await User.create({ name: 'Err', email: 'err-log@example.com', password: 'abcd1234' });
  token = jwt.sign({ userId: String(user._id), id: String(user._id), role: 'JobSeeker' }, process.env.JWT_SECRET);
});

afterAll(dropTestDb);
afterEach(() => jest.restoreAllMocks());

// A minimal app with the real middleware chain and a route that throws.
const throwingApp = (err) => {
  const a = express();
  a.use(requestId);
  a.get('/api/boom', () => {
    throw err;
  });
  a.use(errorHandler);
  return a;
};

describe('unhandled errors (final error middleware)', () => {
  test('route that throws → 500 INTERNAL_ERROR with requestId; entry stored; no stack in response', async () => {
    const err = new TypeError(`Cannot read properties of undefined (token ${JWT_IN_MESSAGE})`);
    const res = await request(throwingApp(err)).get('/api/boom?secret=1').set('X-Request-Id', 'boom-req-0001-abcd');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Reference: boom-req-0001-abcd',
      requestId: 'boom-req-0001-abcd',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/TypeError|at |Cannot read/);

    const entry = await waitFor(() => ErrorLog.findOne({ requestId: 'boom-req-0001-abcd' }).lean());
    expect(entry).toMatchObject({
      level: 'error',
      service: 'core',
      module: 'unhandled',
      errorType: 'TypeError',
      method: 'GET',
      path: '/api/boom', // no query string
      statusCode: 500,
      acknowledged: false,
    });
    expect(entry.timestamp).toBeInstanceOf(Date);
    expect(entry.stack).toMatch(/TypeError/);
    expect(entry.message).toContain('[REDACTED_JWT]');
    expect(entry.message).not.toContain(JWT_IN_MESSAGE);
  });

  test('a database connection error is logged as critical', async () => {
    const err = Object.assign(new Error('connection refused'), { name: 'MongoNetworkError' });
    const res = await request(throwingApp(err)).get('/api/boom').set('X-Request-Id', 'boom-req-0002-abcd');
    expect(res.status).toBe(500);
    const entry = await waitFor(() => ErrorLog.findOne({ requestId: 'boom-req-0002-abcd' }).lean());
    expect(entry.level).toBe('critical');
  });

  test('a failing log write does not break the response (console fallback)', async () => {
    jest.spyOn(ErrorLog, 'create').mockRejectedValue(new Error('disk full'));
    const consoleErr = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(throwingApp(new Error('kaboom'))).get('/api/boom').set('X-Request-Id', 'boom-req-0003-abcd');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    await waitFor(() => consoleErr.mock.calls.some((c) => String(c[0]).includes('[ErrorLog:write-failed')));
    const line = consoleErr.mock.calls.find((c) => String(c[0]).includes('[ErrorLog:write-failed'))[0];
    expect(line).toContain('boom-req-0003-abcd');
    expect(line).not.toContain('"stack"');
  });
});

describe('route handlers that catch errors (handleServerError)', () => {
  test('GET /api/profile with a failing query → logged with module, user and request id', async () => {
    jest.spyOn(Profile, 'findOne').mockImplementation(() => {
      throw new Error('profile query exploded');
    });
    const res = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Request-Id', 'prof-req-0001-abcd');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch profile',
      requestId: 'prof-req-0001-abcd',
    });
    const entry = await waitFor(() => ErrorLog.findOne({ requestId: 'prof-req-0001-abcd' }).lean());
    expect(entry).toMatchObject({
      level: 'error',
      service: 'core',
      module: 'profile',
      message: 'profile query exploded',
      userId: String(user._id),
      path: '/api/profile',
    });
  });

  test('malformed JSON is a 400, not a logged server error', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Request-Id', 'json-req-0001-abcd')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_JSON');
    await new Promise((r) => setTimeout(r, 100));
    expect(await ErrorLog.countDocuments({ requestId: 'json-req-0001-abcd' })).toBe(0);
  });
});

describe('retention (TTL index)', () => {
  test('TTL index exists with the configured retention and is updated in place', async () => {
    const coll = mongoose.connection.db.collection('error_logs');
    expect(await ensureTtlIndex('error_logs', 7)).toBe(7 * 86400);
    let ttl = (await coll.indexes()).find((ix) => ix.name === 'timestamp_ttl');
    expect(ttl.expireAfterSeconds).toBe(7 * 86400);
    expect(ttl.key).toEqual({ timestamp: 1 });

    await ensureTtlIndex('error_logs', 30);
    ttl = (await coll.indexes()).find((ix) => ix.name === 'timestamp_ttl');
    expect(ttl.expireAfterSeconds).toBe(30 * 86400);

    const names = (await coll.indexes()).map((ix) => ix.name);
    expect(names).toEqual(expect.arrayContaining(['timestamp_-1', 'service_1_level_1_timestamp_-1']));
  });
});
