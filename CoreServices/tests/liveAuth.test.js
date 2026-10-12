import { jest } from '@jest/globals';
import crypto from 'crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb } from './helpers.js';
import './authMocks.js';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { default: AdminLog } = await import('../backend/admin/models/AdminLog.js');
const { isLastActiveAdmin } = await import('../backend/admin/controllers/adminUserController.js');

// A token as an existing session would hold it: issued a minute ago, with the
// role claim set by the caller (to prove the claim is never trusted).
const sessionToken = (user, { role = user.role, ageSeconds = 60 } = {}) =>
  jwt.sign(
    { userId: String(user._id), id: String(user._id), role, iat: Math.floor(Date.now() / 1000) - ageSeconds },
    process.env.JWT_SECRET,
  );

const asUser = (token) => ({ Authorization: `Bearer ${token}` });
let n = 0;
const makeUser = (overrides = {}) =>
  User.create({ name: 'Live Auth', email: `live${Date.now()}_${n++}@example.com`, password: 'abcd1234', ...overrides });

beforeAll(async () => {
  await connectTestDb();
  await User.init();
});

afterAll(dropTestDb);

describe('per-request user verification', () => {
  test('missing / invalid / expired tokens carry codes', async () => {
    expect((await request(app).get('/api/profile')).body.code).toBe('NO_TOKEN');
    expect((await request(app).get('/api/profile').set(asUser('garbage'))).body.code).toBe('TOKEN_INVALID');
    const u = await makeUser();
    const expired = jwt.sign({ userId: String(u._id) }, process.env.JWT_SECRET, { expiresIn: -10 });
    const res = await request(app).get('/api/profile').set(asUser(expired));
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'TOKEN_EXPIRED', message: 'Token expired. Please login again.' });
  });

  test('suspended user with a valid token → 403 ACCOUNT_DEACTIVATED on normal and admin routes', async () => {
    const seeker = await makeUser();
    const admin = await makeUser({ role: 'Admin' });
    await makeUser({ role: 'Admin' }); // keep another active admin
    await User.updateMany({ _id: { $in: [seeker._id, admin._id] } }, { $set: { isActive: false } });

    const normal = await request(app).get('/api/profile').set(asUser(sessionToken(seeker)));
    expect(normal.status).toBe(403);
    expect(normal.body).toMatchObject({
      code: 'ACCOUNT_DEACTIVATED',
      message: 'Your account has been suspended. Contact support.',
    });

    const adminRoute = await request(app).get('/api/admin/users').set(asUser(sessionToken(admin)));
    expect(adminRoute.status).toBe(403);
    expect(adminRoute.body.code).toBe('ACCOUNT_DEACTIVATED');
  });

  test('admin demoted to JobSeeker → next admin request 403 even though the token says Admin', async () => {
    const admin = await makeUser({ role: 'Admin' });
    const token = sessionToken(admin);
    expect((await request(app).get('/api/admin/users').set(asUser(token))).status).toBe(200);

    await User.updateOne({ _id: admin._id }, { $set: { role: 'JobSeeker' } });
    const res = await request(app).get('/api/admin/users').set(asUser(token));
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Access denied. Admin privileges required.');
  });

  test('a JobSeeker token forged with role "Admin" gets no admin access', async () => {
    const seeker = await makeUser();
    const res = await request(app).get('/api/admin/users').set(asUser(sessionToken(seeker, { role: 'Admin' })));
    expect(res.status).toBe(403);
  });

  test('deleted user → 401 USER_NOT_FOUND', async () => {
    const u = await makeUser();
    const token = sessionToken(u);
    await User.deleteOne({ _id: u._id });
    const res = await request(app).get('/api/profile').set(asUser(token));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });

  test('change password → old session 401 TOKEN_REVOKED; the returned token works immediately', async () => {
    const u = await makeUser();
    const oldToken = sessionToken(u);
    const res = await request(app)
      .put('/api/auth/password')
      .set(asUser(oldToken))
      .send({ currentPassword: 'abcd1234', newPassword: 'newpass99' });
    expect(res.status).toBe(200);

    const old = await request(app).get('/api/profile').set(asUser(oldToken));
    expect(old.status).toBe(401);
    expect(old.body).toMatchObject({ code: 'TOKEN_REVOKED', message: 'Your session has ended. Please log in again.' });

    expect((await request(app).get('/api/profile').set(asUser(res.body.token))).status).toBe(200);
    const fresh = await User.findById(u._id);
    expect(fresh.passwordChangedAt.getTime()).toBeLessThan(Date.now() - 900); // set to now − 1s
  });

  test('password reset → old session 401 TOKEN_REVOKED and the reset is logged', async () => {
    const u = await makeUser();
    const oldToken = sessionToken(u);
    const raw = crypto.randomBytes(32).toString('hex');
    await User.updateOne(
      { _id: u._id },
      { $set: { resetToken: crypto.createHash('sha256').update(raw).digest('hex'), resetTokenExpiry: Date.now() + 3600000 } },
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const reset = await request(app).post(`/api/auth/reset-password/${raw}`).send({ password: 'reset1234', passwordConfirm: 'reset1234' });
    expect(reset.status).toBe(200);
    const logged = warn.mock.calls.find((c) => String(c[0]).includes('[Security] Password reset'));
    expect(logged?.[1]).toContain(String(u._id));
    warn.mockRestore();

    const res = await request(app).get('/api/profile').set(asUser(oldToken));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_REVOKED');
  });

  test('temporarily locked user keeps an existing session (200)', async () => {
    const u = await makeUser({ failedLoginAttempts: 5, lockUntil: new Date(Date.now() + 15 * 60000) });
    const res = await request(app).get('/api/profile').set(asUser(sessionToken(u)));
    expect(res.status).toBe(200);
  });

  test('users who never changed their password keep working tokens', async () => {
    const u = await makeUser();
    expect((await request(app).get('/api/auth/profile').set(asUser(sessionToken(u, { ageSeconds: 6 * 86400 })))).status).toBe(200);
  });
});

describe('admin safety', () => {
  let admin;
  let adminToken;

  beforeAll(async () => {
    // Isolate: these tests control exactly which admins exist.
    await User.deleteMany({ role: 'Admin' });
    admin = await makeUser({ role: 'Admin' });
    adminToken = sessionToken(admin);
  });

  const asAdmin = (method, path, body) =>
    request(app)[method](`/api/admin${path}`).set(asUser(adminToken)).send(body);

  test('an admin cannot deactivate, demote or delete themselves (sole admin stays intact)', async () => {
    expect((await asAdmin('patch', `/users/${admin._id}/status`, { isActive: false })).status).toBe(400);
    expect((await asAdmin('patch', `/users/${admin._id}/role`, { role: 'JobSeeker' })).status).toBe(400);
    expect((await asAdmin('delete', `/users/${admin._id}`)).status).toBe(400);
    const fresh = await User.findById(admin._id);
    expect(fresh).toMatchObject({ role: 'Admin', isActive: true });
  });

  test('isLastActiveAdmin guard: only true for the sole active admin', async () => {
    expect(await isLastActiveAdmin(await User.findById(admin._id))).toBe(true);

    const suspendedAdmin = await makeUser({ role: 'Admin', isActive: false });
    expect(await isLastActiveAdmin(await User.findById(admin._id))).toBe(true); // suspended admins don't count
    expect(await isLastActiveAdmin(suspendedAdmin)).toBe(false); // already inactive

    const second = await makeUser({ role: 'Admin' });
    expect(await isLastActiveAdmin(await User.findById(admin._id))).toBe(false);
    expect(await isLastActiveAdmin(second)).toBe(false);
    expect(await isLastActiveAdmin(await makeUser())).toBe(false); // not an admin
    await User.deleteMany({ _id: { $in: [suspendedAdmin._id, second._id] } });
  });

  test('suspension, reactivation and role changes of others are allowed and logged', async () => {
    const other = await makeUser({ role: 'Admin' });
    expect((await asAdmin('patch', `/users/${other._id}/status`, { isActive: false })).status).toBe(200);
    expect((await asAdmin('patch', `/users/${other._id}/status`, { isActive: true })).status).toBe(200);
    expect((await asAdmin('patch', `/users/${other._id}/role`, { role: 'JobSeeker' })).status).toBe(200);

    const actions = (await AdminLog.find({ resourceId: String(other._id) }).sort({ createdAt: 1 })).map((l) => l.action);
    expect(actions).toEqual(['DEACTIVATE_USER', 'ACTIVATE_USER', 'CHANGE_USER_ROLE']);
  });
});
