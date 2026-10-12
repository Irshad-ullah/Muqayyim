import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb } from './helpers.js';
import app from '../app.js';
import User from '../backend/models/User.js';

let user;
let token;

beforeAll(async () => {
  await connectTestDb();
  user = await User.create({ name: 'Auth Test', email: 'auth-test@example.com', password: 'Passw0rd!' });
  token = jwt.sign({ userId: user._id, id: user._id, role: user.role }, process.env.JWT_SECRET);
});

afterAll(dropTestDb);

describe('browser cannot change cvStatus', () => {
  test('PATCH /api/auth/cv-status is gone → 404', async () => {
    const res = await request(app)
      .patch('/api/auth/cv-status')
      .set('Authorization', `Bearer ${token}`)
      .send({ cvStatus: 'verified' });
    expect(res.status).toBe(404);
    const fresh = await User.findById(user._id);
    expect(fresh.cvStatus).toBe('not_uploaded');
  });

  test('PUT /api/auth/profile ignores cvStatus', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Auth Test', cvStatus: 'verified' });
    expect(res.status).toBe(200);
    const fresh = await User.findById(user._id);
    expect(fresh.cvStatus).toBe('not_uploaded');
  });

  test('a user JWT cannot reach /internal routes', async () => {
    const res = await request(app)
      .put(`/internal/users/${user._id}/cv-status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'verified' });
    expect(res.status).toBe(401);
  });

  test('GET /api/auth/cv-status still reads the status', async () => {
    const res = await request(app).get('/api/auth/cv-status').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.cvStatus).toBe('not_uploaded');
  });
});
