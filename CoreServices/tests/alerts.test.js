import request from 'supertest';
import { INTERNAL_KEY, connectTestDb, dropTestDb } from './helpers.js';
import { waitFor, sleep } from './logHelpers.js';
import { mail } from './authMocks.js';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { logError } = await import('../backend/services/errorLogger.js');
const { resetAlertState } = await import('../backend/services/alertService.js');

beforeAll(async () => {
  await connectTestDb();
  await User.create({ name: 'Admin One', email: 'alert-admin1@example.com', password: 'admin1234', role: 'Admin' });
  await User.create({ name: 'Admin Two', email: 'alert-admin2@example.com', password: 'admin1234', role: 'Admin' });
  await User.create({ name: 'Suspended', email: 'alert-admin3@example.com', password: 'admin1234', role: 'Admin', isActive: false });
  await User.create({ name: 'Seeker', email: 'alert-seeker@example.com', password: 'abcd1234' });
});

afterAll(dropTestDb);

beforeEach(() => {
  resetAlertState();
  mail.sendEmailRaw.mockClear();
  delete process.env.ALERTS_ENABLED;
});

const critical = (errorType = 'MongoNetworkError', extra = {}) =>
  logError({ level: 'critical', module: 'database', errorType, message: 'connection lost password=hunter2', requestId: 'crit-req-0001-abcd', ...extra });

describe('critical alerts', () => {
  test('a critical entry emails all active admins (not suspended admins or job seekers), without the stack', async () => {
    await critical('MongoNetworkError', { stack: 'Error: boom\n    at secretFunction (file.js:1:1)' });
    await waitFor(() => mail.sendEmailRaw.mock.calls.length > 0);
    expect(mail.sendEmailRaw).toHaveBeenCalledTimes(1);
    const [to, subject, html] = mail.sendEmailRaw.mock.calls[0];
    expect(to.split(',').sort()).toEqual(['alert-admin1@example.com', 'alert-admin2@example.com']);
    expect(subject).toContain('core');
    expect(subject).toContain('MongoNetworkError');
    expect(html).toContain('database');
    expect(html).toContain('crit-req-0001-abcd');
    expect(html).not.toContain('secretFunction');
    expect(html).not.toContain('hunter2');
  });

  test('a second identical critical within the throttle window sends no second email', async () => {
    await critical();
    await waitFor(() => mail.sendEmailRaw.mock.calls.length > 0);
    await critical();
    await critical();
    await sleep(150);
    expect(mail.sendEmailRaw).toHaveBeenCalledTimes(1);

    await critical('UncaughtException'); // different errorType → separate alert
    await waitFor(() => mail.sendEmailRaw.mock.calls.length > 1);
    expect(mail.sendEmailRaw).toHaveBeenCalledTimes(2);
  });

  test('errors and warnings never alert', async () => {
    await logError({ level: 'error', module: 'x', errorType: 'TypeError', message: 'm' });
    await logError({ level: 'warning', module: 'x', errorType: 'Warn', message: 'm' });
    await sleep(150);
    expect(mail.sendEmailRaw).not.toHaveBeenCalled();
  });

  test('ALERTS_ENABLED=false → no email', async () => {
    process.env.ALERTS_ENABLED = 'false';
    await critical();
    await sleep(150);
    expect(mail.sendEmailRaw).not.toHaveBeenCalled();
  });

  test('a failed alert email is reported on the console only (no log loop)', async () => {
    const { default: ErrorLog } = await import('../backend/models/ErrorLog.js');
    mail.sendEmailRaw.mockResolvedValueOnce(false);
    const before = await ErrorLog.countDocuments();
    await critical('SomethingElse');
    await waitFor(() => mail.sendEmailRaw.mock.calls.length > 0);
    await sleep(150);
    expect(await ErrorLog.countDocuments()).toBe(before + 1); // only the critical entry itself
  });
});

describe('POST /internal/alerts (from AIServices)', () => {
  const send = (body, key = INTERNAL_KEY) => request(app).post('/internal/alerts').set('X-Internal-Key', key).send(body);

  test('requires the internal key and valid fields', async () => {
    expect((await request(app).post('/internal/alerts').send({})).status).toBe(401);
    expect((await send({ service: 'core', errorType: 'X' })).status).toBe(400);
  });

  test('emails admins once per (service, errorType) within the window', async () => {
    const body = { service: 'ai', module: 'database', errorType: 'ServerSelectionTimeoutError', message: 'no mongo token=tok999secret', requestId: 'ai-crit-0001-abcd' };
    const first = await send(body);
    expect(first.body.result).toBe('sent');
    const second = await send(body);
    expect(second.body.result).toBe('throttled');
    expect(mail.sendEmailRaw).toHaveBeenCalledTimes(1);
    expect(mail.sendEmailRaw.mock.calls[0][2]).not.toContain('tok999secret');
  });
});
