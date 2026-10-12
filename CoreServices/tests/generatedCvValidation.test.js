import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb } from './helpers.js';
import './authMocks.js';

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { default: GeneratedCv } = await import('../backend/models/GeneratedCv.js');

let token;
let user;
let n = 0;

const cvData = (over = {}) => ({
  personal: { fullName: 'Ada Lovelace', email: 'ada@example.com', linkedin: 'linkedin.com/in/ada' },
  summary: 'Engineer.',
  skills: [{ category: 'Languages', items: ['JavaScript', 'javascript', 'Python'] }],
  experience: [{ title: 'Engineer', company: 'Acme', startDate: 'Jan 2020', endDate: 'Present' }],
  education: [],
  projects: [],
  certifications: [],
  ...over,
});
const payload = (over = {}) => ({ title: 'My CV', template: 'modern', settings: { accentColor: 'navy' }, data: cvData(), ...over });
const create = (body) => request(app).post('/api/generated-cvs').set('Authorization', `Bearer ${token}`).send(body);
const fields = (res) => res.body.errors.map((e) => e.field);

beforeAll(async () => {
  await connectTestDb();
  await User.init();
});

beforeEach(async () => {
  user = await User.create({ name: 'CV Tester', email: `cvv${Date.now()}_${n++}@example.com`, password: 'abcd1234' });
  token = jwt.sign({ userId: String(user._id), id: String(user._id), role: 'JobSeeker' }, process.env.JWT_SECRET);
});

afterAll(dropTestDb);

describe('generated CV settings', () => {
  test('valid payload is normalised and saved', async () => {
    const res = await create(payload({ settings: { accentColor: 'blue', sectionOrder: ['projects', 'summary'] } }));
    expect(res.status).toBe(201);
    const { cv } = res.body;
    expect(cv.settings.accentColor).toBe('navy'); // legacy key mapped
    expect(cv.settings.sectionOrder.slice(0, 2)).toEqual(['projects', 'summary']);
    expect(cv.settings.sectionOrder).toHaveLength(6);
    expect(cv.data.experience[0]).toMatchObject({ startDate: '2020-01', endDate: '', current: true });
    expect(cv.data.skills[0].items).toEqual(['JavaScript', 'Python']);
    expect(cv.data.personal.linkedin).toBe('https://linkedin.com/in/ada');
  });

  test.each([
    [{ template: 'fancy' }, 'template'],
    [{ title: 'x'.repeat(101) }, 'title'],
    [{ settings: { accentColor: '#ff0000' } }, 'settings.accentColor'],
    [{ settings: { fontFamily: 'comic' } }, 'settings.fontFamily'],
    [{ settings: { fontSize: 12 } }, 'settings.fontSize'],
    [{ settings: { sectionOrder: ['summary', 'hobbies'] } }, 'settings.sectionOrder[1]'],
    [{ settings: { sectionOrder: ['summary', 'skills', 'summary'] } }, 'settings.sectionOrder[2]'],
    [{ settings: { hiddenSections: ['nope'] } }, 'settings.hiddenSections[0]'],
  ])('%j → 400 on %s', async (over, field) => {
    const res = await create(payload(over));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(fields(res)).toContain(field);
  });

  test('snapshot over 200 KB → 400 on data', async () => {
    const res = await create(payload({ data: cvData({ padding: 'x'.repeat(205 * 1024) }) }));
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(['data']);
  });

  test('snapshot entries follow the profile rules', async () => {
    const res = await create(
      payload({
        data: cvData({
          experience: [{ title: 'Engineer', company: '', startDate: '2022-01', endDate: '2021-01' }],
          projects: [{ name: 'X', url: 'https://github.com/only-owner', liveUrl: 'javascript:void(0)' }],
          certifications: [{ name: 'AWS', issuer: '' }],
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(
      expect.arrayContaining([
        'data.experience[0].company',
        'data.experience[0].endDate',
        'data.projects[0].url',
        'data.projects[0].liveUrl',
        'data.certifications[0].issuer',
      ]),
    );
  });

  test('update uses the same validation', async () => {
    const { body } = await create(payload());
    const res = await request(app)
      .put(`/api/generated-cvs/${body.cv._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(payload({ data: cvData({ experience: [{ title: 'E', company: 'C', startDate: 'soon' }] }) }));
    expect(res.status).toBe(400);
    expect(fields(res)).toContain('data.experience[0].startDate');
  });
});

describe('FR6.8 PROFILE_INCOMPLETE', () => {
  test('missing name → missing: ["name"]', async () => {
    const res = await create(payload({ data: cvData({ personal: { fullName: '  ' } }) }));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'PROFILE_INCOMPLETE', missing: ['name'] });
  });

  test('a summary alone is not enough content', async () => {
    const res = await create(payload({ data: cvData({ skills: [], experience: [] }) }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROFILE_INCOMPLETE');
    expect(res.body.missing).toEqual(['experience', 'education', 'projects', 'skills']);
  });

  test('any one of the sections is enough (skills only)', async () => {
    const res = await create(payload({ data: cvData({ experience: [], summary: '' }) }));
    expect(res.status).toBe(201);
  });

  test('nothing is saved when incomplete', async () => {
    await create(payload({ data: cvData({ personal: {} }) }));
    expect(await GeneratedCv.countDocuments({ userId: user._id })).toBe(0);
  });
});
