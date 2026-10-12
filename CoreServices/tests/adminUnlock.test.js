import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb } from './helpers.js';
import './authMocks.js';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { default: AdminLog } = await import('../backend/admin/models/AdminLog.js');

const sign = (user) => jwt.sign({ userId: user._id, id: user._id, role: user.role }, process.env.JWT_SECRET);
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

let admin;
let adminToken;
let seeker;
let seekerToken;

beforeAll(async () => {
  await connectTestDb();
  await User.init();
  admin = await User.create({ name: 'Admin', email: 'admin-unlock@example.com', password: 'admin1234', role: 'Admin' });
  seeker = await User.create({ name: 'Seeker', email: 'seeker-unlock@example.com', password: 'seek1234' });
  adminToken = sign(admin);
  seekerToken = sign(seeker);
});

afterAll(dropTestDb);

const lockSeeker = async () => {
  for (let i = 0; i < 5; i++) await login(seeker.email, 'wrong-pass1');
  expect((await login(seeker.email, 'seek1234')).status).toBe(423);
};

describe('admin unlock', () => {
  test('locked users show isLocked and lockUntil in list and detail', async () => {
    await lockSeeker();
    const list = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${adminToken}`);
    const row = list.body.data.find((u) => u.email === seeker.email);
    expect(row.isLocked).toBe(true);
    expect(new Date(row.lockUntil).getTime()).toBeGreaterThan(Date.now());
    expect(row.password).toBeUndefined();

    const detail = await request(app).get(`/api/admin/users/${seeker._id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.data.user.isLocked).toBe(true);

    const adminRow = list.body.data.find((u) => u.email === admin.email);
    expect(adminRow.isLocked).toBe(false);
    expect(adminRow.lockUntil).toBeNull();
  });

  test('non-admin cannot unlock → 403', async () => {
    const res = await request(app).post(`/api/admin/users/${seeker._id}/unlock`).set('Authorization', `Bearer ${seekerToken}`);
    expect(res.status).toBe(403);
    expect((await User.findById(seeker._id)).isLocked()).toBe(true);
  });

  test('admin unlock → user can log in, AdminLog entry written', async () => {
    const res = await request(app).post(`/api/admin/users/${seeker._id}/unlock`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.isLocked).toBe(false);

    const log = await AdminLog.findOne({ action: 'UNLOCK_USER', resourceId: String(seeker._id) });
    expect(log).not.toBeNull();
    expect(String(log.adminId)).toBe(String(admin._id));
    expect(log.details.wasLocked).toBe(true);

    expect((await login(seeker.email, 'seek1234')).status).toBe(200);
  });

  test('unknown user → 404', async () => {
    const res = await request(app).post('/api/admin/users/507f1f77bcf86cd799439011/unlock').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('admin email edit and admin creation', () => {
  test('changing a user email to an existing one (any case) → 409', async () => {
    const res = await request(app)
      .put(`/api/admin/users/${seeker._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: '  ADMIN-UNLOCK@example.com ' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Email already in use');
  });

  test('create-admin applies the password policy', async () => {
    const res = await request(app)
      .post('/api/admin/auth/create-admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'new-admin@example.com', name: 'New Admin', password: 'abcdef' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('password');

    const ok = await request(app)
      .post('/api/admin/auth/create-admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: ' New-Admin@Example.com', name: 'New Admin', password: 'admin5678' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.email).toBe('new-admin@example.com');
  });
});
