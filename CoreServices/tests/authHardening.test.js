import { jest } from '@jest/globals';
import crypto from 'crypto';
import request from 'supertest';
import { connectTestDb, dropTestDb } from './helpers.js';
import { mail } from './authMocks.js';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');

const STRONG = 'abcd1234';
let counter = 0;
const uniqueEmail = () => `user${Date.now()}_${counter++}@example.com`;

const register = (body) => request(app).post('/api/auth/register').send(body);
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

const createUser = async (email = uniqueEmail(), password = STRONG) => {
  const res = await register({ name: 'Test User', email, password, passwordConfirm: password });
  expect(res.status).toBe(201);
  return { email, password, id: res.body.user.id, token: res.body.token };
};

beforeAll(async () => {
  await connectTestDb();
  await User.init(); // build the unique email index before testing races
});

afterAll(dropTestDb);

describe('registration', () => {
  test('weak password → 400 with field-level errors', async () => {
    const res = await register({ name: 'A', email: uniqueEmail(), password: 'abcdefgh', passwordConfirm: 'abcdefgh' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors).toEqual([{ field: 'password', message: 'Password must contain at least one number' }]);
  });

  test('strong password → 201', async () => {
    const res = await register({ name: 'A', email: uniqueEmail(), password: STRONG, passwordConfirm: STRONG });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
  });

  test('duplicate email → 409 "Email already in use"', async () => {
    const { email } = await createUser();
    const res = await register({ name: 'B', email, password: STRONG, passwordConfirm: STRONG });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Email already in use');
  });

  test('duplicate with different case and spaces → 409', async () => {
    const { email } = await createUser();
    const res = await register({ name: 'B', email: `  ${email.toUpperCase()} `, password: STRONG, passwordConfirm: STRONG });
    expect(res.status).toBe(409);
  });

  test('two simultaneous registrations → one 201, one 409 (unique index)', async () => {
    const email = uniqueEmail();
    const body = { name: 'Race', email, password: STRONG, passwordConfirm: STRONG };
    const statuses = (await Promise.all([register(body), register(body)])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await User.countDocuments({ email })).toBe(1);
  });

  test('email is stored normalised', async () => {
    const res = await register({ name: 'N', email: '  MiXeD.Case@Example.COM ', password: STRONG, passwordConfirm: STRONG });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('mixed.case@example.com');
  });
});

describe('login lockout', () => {
  test('4 wrong passwords then the correct one → 200 and counter reset', async () => {
    const u = await createUser();
    for (let i = 0; i < 4; i++) expect((await login(u.email, 'wrong-pass1')).status).toBe(401);
    expect((await User.findById(u.id)).failedLoginAttempts).toBe(4);

    const res = await login(u.email, u.password);
    expect(res.status).toBe(200);
    const fresh = await User.findById(u.id);
    expect(fresh.failedLoginAttempts).toBe(0);
    expect(fresh.lockUntil).toBeNull();
    expect(fresh.lastLogin).toBeInstanceOf(Date);
  });

  test('5 wrong passwords lock the account; the correct password is then refused with 423', async () => {
    const u = await createUser();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    for (let i = 0; i < 4; i++) expect((await login(u.email, 'wrong-pass1')).status).toBe(401);
    const fifth = await login(u.email, 'wrong-pass1');
    expect(fifth.status).toBe(423); // this attempt triggered the lock
    expect(fifth.body.retryAfterMinutes).toBe(15);

    const sixth = await login(u.email, u.password);
    expect(sixth.status).toBe(423);
    expect(sixth.body.message).toBe(
      'Account temporarily locked due to too many failed attempts. Try again in 15 minutes.',
    );
    expect(sixth.body.token).toBeUndefined();

    // Lock event logged once, through logSecurityEvent, without the password.
    const lockLogs = warn.mock.calls.filter((c) => String(c[0]).includes('[Security] Account locked'));
    expect(lockLogs).toHaveLength(1);
    expect(lockLogs[0][1]).toContain(u.id);
    expect(lockLogs[0].join(' ')).not.toContain('wrong-pass1');
    expect(lockLogs[0].join(' ')).not.toContain(u.password);
    warn.mockRestore();
  });

  test('parallel wrong attempts cannot bypass the counter', async () => {
    const u = await createUser();
    const results = await Promise.all(Array.from({ length: 10 }, () => login(u.email, 'wrong-pass1')));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 423).length).toBeGreaterThanOrEqual(1);
    const fresh = await User.findById(u.id);
    expect(fresh.isLocked()).toBe(true);
    expect((await login(u.email, u.password)).status).toBe(423);
  });

  test('after the lock expires the correct password works and the counter resets', async () => {
    const u = await createUser();
    await User.updateOne({ _id: u.id }, { $set: { failedLoginAttempts: 5, lockUntil: new Date(Date.now() - 1000) } });

    const res = await login(u.email, u.password);
    expect(res.status).toBe(200);
    const fresh = await User.findById(u.id);
    expect(fresh.failedLoginAttempts).toBe(0);
    expect(fresh.lockUntil).toBeNull();
  });

  test('a wrong password after an expired lock restarts the count at 1', async () => {
    const u = await createUser();
    await User.updateOne({ _id: u.id }, { $set: { failedLoginAttempts: 5, lockUntil: new Date(Date.now() - 1000) } });

    expect((await login(u.email, 'wrong-pass1')).status).toBe(401);
    const fresh = await User.findById(u.id);
    expect(fresh.failedLoginAttempts).toBe(1);
    expect(fresh.lockUntil).toBeNull();
  });

  test('unknown email → 401 with the same message as a wrong password', async () => {
    const u = await createUser();
    const unknown = await login('nobody-here@example.com', STRONG);
    const wrong = await login(u.email, 'wrong-pass1');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  test('login normalises the email', async () => {
    const u = await createUser();
    expect((await login(`  ${u.email.toUpperCase()}  `, u.password)).status).toBe(200);
  });

  test('users with an old weaker password can still log in', async () => {
    const email = uniqueEmail();
    await User.create({ name: 'Legacy', email, password: 'abcdef' }); // pre-policy password
    expect((await login(email, 'abcdef')).status).toBe(200);
  });
});

describe('password reset', () => {
  const setResetToken = async (userId) => {
    const raw = crypto.randomBytes(32).toString('hex');
    await User.updateOne(
      { _id: userId },
      { $set: { resetToken: crypto.createHash('sha256').update(raw).digest('hex'), resetTokenExpiry: Date.now() + 3600000 } },
    );
    return raw;
  };

  test('weak new password → 400', async () => {
    const u = await createUser();
    const token = await setResetToken(u.id);
    const res = await request(app).post(`/api/auth/reset-password/${token}`).send({ password: '12345678', passwordConfirm: '12345678' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('password');
  });

  test('a successful reset clears the lock', async () => {
    const u = await createUser();
    for (let i = 0; i < 5; i++) await login(u.email, 'wrong-pass1');
    expect((await User.findById(u.id)).isLocked()).toBe(true);

    const token = await setResetToken(u.id);
    const res = await request(app).post(`/api/auth/reset-password/${token}`).send({ password: 'newpass99', passwordConfirm: 'newpass99' });
    expect(res.status).toBe(200);

    const fresh = await User.findById(u.id);
    expect(fresh.isLocked()).toBe(false);
    expect(fresh.failedLoginAttempts).toBe(0);
    expect(fresh.passwordChangedAt).toBeInstanceOf(Date);
    expect((await login(u.email, 'newpass99')).status).toBe(200);
  });
});

describe('profile email change', () => {
  test('changing to an existing email (any case) → 409', async () => {
    const a = await createUser();
    const b = await createUser();
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ email: a.email.toUpperCase() });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Email already in use');
  });
});

describe('PUT /api/auth/password (change password)', () => {
  const change = (token, body) =>
    request(app).put('/api/auth/password').set('Authorization', `Bearer ${token}`).send(body);

  test('no token → 401', async () => {
    const res = await request(app).put('/api/auth/password').send({ currentPassword: STRONG, newPassword: 'newpass99' });
    expect(res.status).toBe(401);
  });

  test('wrong current password → 400 on currentPassword, session still valid', async () => {
    const u = await createUser();
    const res = await change(u.token, { currentPassword: 'wrong-pass1', newPassword: 'newpass99' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ field: 'currentPassword', message: 'Current password is incorrect' });
    // Not logged out: the same token still works.
    expect((await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${u.token}`)).status).toBe(200);
  });

  test('weak new password → 400 on newPassword', async () => {
    const u = await createUser();
    const res = await change(u.token, { currentPassword: u.password, newPassword: 'short1' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('newPassword');
    expect(res.body.errors[0].field).toBe('newPassword');
  });

  test('new password equal to current → 400', async () => {
    const u = await createUser();
    const res = await change(u.token, { currentPassword: u.password, newPassword: u.password });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('newPassword');
  });

  test('success → 200 with a fresh token; old password stops working, new one works', async () => {
    const u = await createUser();
    await User.updateOne({ _id: u.id }, { $set: { failedLoginAttempts: 3 } });
    mail.sendPasswordChangedEmail.mockClear();

    const res = await change(u.token, { currentPassword: u.password, newPassword: 'brandnew42' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect((await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${res.body.token}`)).status).toBe(200);

    const fresh = await User.findById(u.id);
    expect(fresh.passwordChangedAt).toBeInstanceOf(Date);
    expect(fresh.failedLoginAttempts).toBe(0);
    expect(mail.sendPasswordChangedEmail).toHaveBeenCalledWith(u.email, 'Test User');

    expect((await login(u.email, u.password)).status).toBe(401);
    expect((await login(u.email, 'brandnew42')).status).toBe(200);
  });

  test('a mail failure does not fail the request', async () => {
    const u = await createUser();
    mail.sendPasswordChangedEmail.mockImplementationOnce(async () => {
      throw new Error('SMTP down');
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await change(u.token, { currentPassword: u.password, newPassword: 'brandnew42' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(err.mock.calls.some((c) => String(c[0]).includes('Password-changed email'))).toBe(true);
    err.mockRestore();
  });
});
