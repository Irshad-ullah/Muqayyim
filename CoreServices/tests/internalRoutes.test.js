import request from 'supertest';
import mongoose from 'mongoose';
import { INTERNAL_KEY, connectTestDb, dropTestDb } from './helpers.js';
import app from '../app.js';
import User from '../backend/models/User.js';

let user;

beforeAll(async () => {
  await connectTestDb();
  user = await User.create({ name: 'Internal Test', email: 'internal-test@example.com', password: 'Passw0rd!' });
});

afterAll(dropTestDb);

const url = (id) => `/internal/users/${id}/cv-status`;

describe('PUT /internal/users/:userId/cv-status', () => {
  test('new users default to not_uploaded', () => {
    expect(user.cvStatus).toBe('not_uploaded');
  });

  test('without key → 401', async () => {
    const res = await request(app).put(url(user._id)).send({ status: 'parsed' });
    expect(res.status).toBe(401);
  });

  test('with wrong key → 403', async () => {
    const res = await request(app).put(url(user._id)).set('X-Internal-Key', 'nope').send({ status: 'parsed' });
    expect(res.status).toBe(403);
  });

  test('invalid status → 400 and DB unchanged', async () => {
    const res = await request(app)
      .put(url(user._id))
      .set('X-Internal-Key', INTERNAL_KEY)
      .send({ status: 'Verified' });
    expect(res.status).toBe(400);
    const fresh = await User.findById(user._id);
    expect(fresh.cvStatus).toBe('not_uploaded');
  });

  test('valid status → 200 and DB updated', async () => {
    const res = await request(app)
      .put(url(user._id))
      .set('X-Internal-Key', INTERNAL_KEY)
      .send({ status: 'processing' });
    expect(res.status).toBe(200);
    expect(res.body.cvStatus).toBe('processing');
    const fresh = await User.findById(user._id);
    expect(fresh.cvStatus).toBe('processing');
  });

  test('unknown user → 404', async () => {
    const res = await request(app)
      .put(url(new mongoose.Types.ObjectId()))
      .set('X-Internal-Key', INTERNAL_KEY)
      .send({ status: 'parsed' });
    expect(res.status).toBe(404);
  });
});

describe('GET /internal/users/:userId/auth-state', () => {
  const url = (id) => `/internal/users/${id}/auth-state`;

  test('no key → 401, wrong key → 403', async () => {
    expect((await request(app).get(url(user._id))).status).toBe(401);
    expect((await request(app).get(url(user._id)).set('X-Internal-Key', 'nope')).status).toBe(403);
  });

  test('correct key → current state from the database', async () => {
    const changedAt = new Date('2026-01-02T03:04:05Z');
    await User.updateOne({ _id: user._id }, { $set: { isActive: false, passwordChangedAt: changedAt } });
    const res = await request(app).get(url(user._id)).set('X-Internal-Key', INTERNAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      exists: true,
      isActive: false,
      role: 'JobSeeker',
      passwordChangedAt: changedAt.toISOString(),
    });
    expect(res.body.password).toBeUndefined();
  });

  test('unknown or malformed id → 404 { exists: false }', async () => {
    for (const id of [new mongoose.Types.ObjectId(), 'not-an-id']) {
      const res = await request(app).get(url(id)).set('X-Internal-Key', INTERNAL_KEY);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ exists: false });
    }
  });
});
