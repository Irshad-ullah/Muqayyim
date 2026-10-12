import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, dropTestDb } from './helpers.js';
import { waitFor } from './logHelpers.js';
import './authMocks.js';

// The GitHub API is never called: the username has to be validated first.
const fetchUserRepos = jest.fn(async () => [
  { repoId: 1, name: 'demo', description: 'Demo', url: 'https://github.com/octo-cat/demo', language: 'JavaScript', topics: ['react'], stars: 3 },
]);
jest.unstable_mockModule('../backend/services/githubService.js', () => ({
  fetchUserRepos,
  extractSkillsFromRepos: () => ['JavaScript', 'react'],
}));

const { default: app } = await import('../app.js');
const { default: User } = await import('../backend/models/User.js');
const { default: Profile } = await import('../backend/models/Profile.js');
const { default: ErrorLog } = await import('../backend/models/ErrorLog.js');
const { handleServerError } = await import('../backend/utils/serverError.js');

let user;
let token;
let n = 0;

const now = new Date();
const pad = (v) => String(v).padStart(2, '0');
const nextMonth = (() => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
})();
const thisYear = now.getUTCFullYear();

const put = (body, t = token) => request(app).put('/api/profile').set('Authorization', `Bearer ${t}`).send(body);
const fields = (res) => res.body.errors.map((e) => e.field);

const job = (over = {}) => ({ title: 'Developer', company: 'Acme', startDate: '2020-01', endDate: '2021-06', ...over });
const school = (over = {}) => ({ institution: 'FAST', degree: 'BS CS', startDate: '2016', endDate: '2020', ...over });

const expect400 = (res, expectedFields) => {
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
  expect(typeof res.body.message).toBe('string');
  expect(fields(res)).toEqual(expect.arrayContaining(expectedFields));
};

beforeAll(async () => {
  await connectTestDb();
  await Promise.all([User.init(), Profile.init(), ErrorLog.init()]);
});

beforeEach(async () => {
  user = await User.create({ name: 'Profile Tester', email: `pv${Date.now()}_${n++}@example.com`, password: 'abcd1234' });
  token = jwt.sign({ userId: String(user._id), id: String(user._id), role: 'JobSeeker' }, process.env.JWT_SECRET);
  fetchUserRepos.mockClear();
});

afterAll(dropTestDb);

describe('FR5.1 personal info, name and email', () => {
  test.each([
    ['12345', 'too short'],
    ['1'.repeat(21), 'too long'],
    ['+92 abc 1234567', 'letters'],
    ['+() - - - 12', 'fewer than 7 digits'],
  ])('phone %s → 400 on personalInfo.phone (%s)', async (phone) => {
    expect400(await put({ personalInfo: { phone } }), ['personalInfo.phone']);
  });

  test('valid phone, location and links are normalised', async () => {
    const res = await put({
      personalInfo: { phone: ' +92 (300) 123-4567 ', location: ' Lahore ', linkedin: 'linkedin.com/in/me', github: 'HTTPS://www.github.com/me', website: '' },
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.personalInfo).toMatchObject({
      phone: '+92 (300) 123-4567',
      location: 'Lahore',
      linkedin: 'https://linkedin.com/in/me',
      github: 'https://github.com/me',
    });
  });

  test('links must be http(s)', async () => {
    expect400(await put({ personalInfo: { website: 'javascript:alert(1)', linkedin: 'ftp://x.com/a' } }), [
      'personalInfo.website',
      'personalInfo.linkedin',
    ]);
  });

  test('email cannot be changed through the profile API (top level or personalInfo)', async () => {
    const top = await put({ email: 'new@example.com', summary: 'x' });
    expect400(top, ['email']);
    const nested = await put({ personalInfo: { email: 'new@example.com' } });
    expect400(nested, ['personalInfo.email']);
    expect((await User.findById(user._id)).email).toBe(user.email);
    expect(await Profile.findOne({ userId: user._id })).toBeNull();
  });

  test('name is 2–100 characters on the account endpoint (it lives on the User)', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const short = await request(app).put('/api/auth/profile').set(auth).send({ name: ' A ' });
    expect400(short, ['name']);
    const long = await request(app).put('/api/auth/profile').set(auth).send({ name: 'x'.repeat(101) });
    expect400(long, ['name']);
    const ok = await request(app).put('/api/auth/profile').set(auth).send({ name: '  Ada   Lovelace ' });
    expect(ok.status).toBe(200);
    expect((await User.findById(user._id)).name).toBe('Ada Lovelace');
    expect400(await put({ name: 'Someone Else' }), ['name']);
  });
});

describe('FR5.2 summary and partial updates', () => {
  test('summary over 500 characters → 400 on summary', async () => {
    expect400(await put({ summary: 'x'.repeat(501) }), ['summary']);
  });

  test('summary-only save validates and writes only the summary', async () => {
    expect((await put({ experience: [job()], skills: { manual: ['React'] } })).status).toBe(200);
    const res = await put({ summary: '  Backend developer\u0007 with 3 years\r\nof Node.  ' });
    expect(res.status).toBe(200);
    expect(res.body.profile.summary).toBe('Backend developer with 3 years\nof Node.');
    expect(res.body.profile.experience).toHaveLength(1);
    expect(res.body.profile.skills.manual).toEqual(['React']);
  });

  test('a present section is validated completely even when only one entry changed', async () => {
    const res = await put({ experience: [job(), job({ company: '' })] });
    expect400(res, ['experience[1].company']);
  });
});

describe('FR5.3 experience', () => {
  test('title, company and start are required', async () => {
    const res = await put({ experience: [{ title: '', company: '  ', startDate: '' , current: true }] });
    expect400(res, ['experience[0].title', 'experience[0].company', 'experience[0].startDate']);
  });

  test('end date is required unless current', async () => {
    expect400(await put({ experience: [job({ endDate: '' })] }), ['experience[0].endDate']);
    const res = await put({ experience: [job({ endDate: '2022-01', current: true })] });
    expect(res.status).toBe(200);
    expect(res.body.profile.experience[0]).toMatchObject({ current: true, endDate: '' });
  });

  test('start must be before end (exact path on the second entry)', async () => {
    const res = await put({ experience: [job(), job({ startDate: '2022-05', endDate: '2021-01' })] });
    expect400(res, ['experience[1].endDate']);
    expect(res.body.errors.find((e) => e.field === 'experience[1].endDate').message).toMatch(/after the start date/);
  });

  test('no dates after the current month', async () => {
    expect400(await put({ experience: [job({ startDate: nextMonth, current: true, endDate: '' })] }), ['experience[0].startDate']);
    expect400(await put({ experience: [job({ endDate: nextMonth })] }), ['experience[0].endDate']);
  });

  test('accepted formats are normalised: Mon YYYY, ISO, YYYY, Present', async () => {
    const res = await put({
      experience: [
        job({ startDate: 'Jan 2020', endDate: '2021-06-15T00:00:00.000Z' }),
        job({ startDate: '2019', endDate: 'Present' }),
        job({ startDate: '03/2018', endDate: 'September 2018' }),
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.experience.map((e) => [e.startDate, e.endDate, e.current])).toEqual([
      ['2020-01', '2021-06', false],
      ['2019', '', true],
      ['2018-03', '2018-09', false],
    ]);
  });

  test('unrecognised date text → 400', async () => {
    expect400(await put({ experience: [job({ startDate: 'last summer' })] }), ['experience[0].startDate']);
  });

  test('at most 30 entries', async () => {
    expect400(await put({ experience: Array.from({ length: 31 }, () => job()) }), ['experience']);
  });
});

describe('FR5.4 education', () => {
  test('degree and institution are required', async () => {
    expect400(await put({ education: [school({ degree: '', institution: '' })] }), ['education[0].degree', 'education[0].institution']);
  });

  test('start before end; expected graduation may be in the future', async () => {
    expect400(await put({ education: [school({ startDate: '2021', endDate: '2019' })] }), ['education[0].endDate']);
    const res = await put({ education: [school({ startDate: '2024-09', endDate: `${thisYear + 2}-06` })] });
    expect(res.status).toBe(200);
  });

  test('at most 15 entries', async () => {
    expect400(await put({ education: Array.from({ length: 16 }, () => school()) }), ['education']);
  });
});

describe('FR5.5 skills', () => {
  test('trimmed, de-duplicated across sources case-insensitively, first spelling kept', async () => {
    const res = await put({ skills: { manual: ['  React ', 'node.js'], cv: ['REACT', 'Python', ''], extracted: ['python', 'Docker'] } });
    expect(res.status).toBe(200);
    expect(res.body.profile.skills).toEqual({ manual: ['React', 'node.js'], cv: ['Python'], extracted: ['Docker'] });
  });

  test('over 50 characters → 400 on the exact entry', async () => {
    expect400(await put({ skills: { cv: ['ok', 'x'.repeat(51)] } }), ['skills.cv[1]']);
  });

  test('more than 100 in total → 400 on skills', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `skill-${i}`);
    expect400(await put({ skills: { manual: many.slice(0, 60), cv: many.slice(60) } }), ['skills']);
  });

  test('extract-skills merges with the same rules', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const ok = await request(app)
      .post('/api/profile/extract-skills')
      .set(auth)
      .send({ manualSkills: ['react'], cvSkills: [{ name: 'React' }, ' Node '], githubSkills: ['NODE', 'Go'] });
    expect(ok.status).toBe(200);
    expect(ok.body.skills).toEqual(['Go', 'Node', 'react']);

    const long = await request(app).post('/api/profile/extract-skills').set(auth).send({ cvSkills: ['x'.repeat(51)] });
    expect400(long, ['cvSkills[0]']);
    const tooMany = await request(app)
      .post('/api/profile/extract-skills')
      .set(auth)
      .send({ manualSkills: Array.from({ length: 101 }, (_, i) => `s${i}`) });
    expect400(tooMany, ['skills']);
  });
});

describe('FR5.6 certifications', () => {
  test('name and issuer required; link must be http(s); date not in the future', async () => {
    const res = await put({
      certifications: [
        { name: '', issuer: '' },
        { name: 'AWS', issuer: 'Amazon', url: 'ftp://aws.com/cert' },
        { name: 'GCP', issuer: 'Google', date: nextMonth },
      ],
    });
    expect400(res, ['certifications[0].name', 'certifications[0].issuer', 'certifications[1].url', 'certifications[2].date']);
  });
});

describe('FR5.7 projects', () => {
  test('name required, description ≤ 1000', async () => {
    expect400(await put({ projects: { manual: [{ name: '', description: 'x'.repeat(1001) }] } }), [
      'projects.manual[0].name',
      'projects.manual[0].description',
    ]);
  });

  test('GitHub links must be repository URLs; live links must be http(s)', async () => {
    const ok = await put({
      projects: {
        manual: [
          { name: 'A', url: 'https://github.com/octo-cat/repo-1' },
          { name: 'B', url: 'https://github.com/octo-cat/repo.js.git' },
          { name: 'C', url: 'https://github.com/octo-cat/repo/' },
          { name: 'D', url: 'https://demo.example.com/app' },
        ],
      },
    });
    expect(ok.status).toBe(200);

    const bad = await put({
      projects: {
        manual: [
          { name: 'A', url: 'https://github.com/octo-cat' },
          { name: 'B', url: 'https://github.com/-bad/repo' },
          { name: 'C', url: 'javascript:alert(1)' },
        ],
        github: [{ name: 'D', url: 'https://gitlab.com/x/y' }],
      },
    });
    expect400(bad, ['projects.manual[0].url', 'projects.manual[1].url', 'projects.manual[2].url', 'projects.github[0].url']);
  });

  test('at most 50 per list', async () => {
    expect400(await put({ projects: { manual: Array.from({ length: 51 }, (_, i) => ({ name: `p${i}` })) } }), ['projects.manual']);
  });
});

describe('FR5.8 GitHub username', () => {
  test.each(['-octocat', 'octocat-', 'octo--cat', 'octo_cat', 'x'.repeat(40), ''])('%s → 400, GitHub not called', async (username) => {
    const res = await request(app).post('/api/profile/github').set('Authorization', `Bearer ${token}`).send({ username });
    expect400(res, ['username']);
    expect(fetchUserRepos).not.toHaveBeenCalled();
  });

  test('valid username → fetched and stored', async () => {
    const res = await request(app).post('/api/profile/github').set('Authorization', `Bearer ${token}`).send({ username: ' octo-cat ' });
    expect(res.status).toBe(200);
    expect(fetchUserRepos).toHaveBeenCalledWith('octo-cat');
    expect((await Profile.findOne({ userId: user._id })).githubData.username).toBe('octo-cat');
  });

  test('githubData.username in a profile save follows the same rule', async () => {
    expect400(await put({ githubData: { username: 'bad--name' } }), ['githubData.username']);
  });
});

describe('general rules', () => {
  test.each([
    [{ experience: 'not-an-array' }, 'experience'],
    [{ summary: 123 }, 'summary'],
    [{ skills: 'react' }, 'skills'],
    [{ personalInfo: ['x'] }, 'personalInfo'],
    [{ projects: { manual: 'x' } }, 'projects.manual'],
    [{ experience: [job({ current: 'yes' })] }, 'experience[0].current'],
    [{ projects: { github: [{ name: 'r', url: 'https://github.com/a/b', stars: 'many' }] } }, 'projects.github[0].stars'],
    [{ cvImportedAt: 'not a date' }, 'cvImportedAt'],
  ])('wrong type %j → 400 on %s (was a 500 CastError)', async (body, field) => {
    const res = await put(body);
    expect400(res, [field]);
  });

  test('unknown top-level keys → 400; read-only keys from GET are ignored', async () => {
    expect400(await put({ summary: 'ok', isAdmin: true }), ['isAdmin']);
    const res = await put({ _id: 'x', __v: 3, userId: 'someone-else', createdAt: 'x', updatedAt: 'x', summary: 'ok' });
    expect(res.status).toBe(200);
    expect(String(res.body.profile.userId)).toBe(String(user._id));
  });

  test('control characters are stripped and strings trimmed', async () => {
    const res = await put({ experience: [job({ title: ' \u0000Senior\tDev\u001f ' })] });
    expect(res.status).toBe(200);
    expect(res.body.profile.experience[0].title).toBe('Senior Dev');
  });

  test('bodies over 1 MB → 413', async () => {
    const res = await put({ summary: 'x'.repeat(1024 * 1024 + 10) });
    expect(res.status).toBe(413);
  });

  test('existing invalid data still loads (validation applies on write)', async () => {
    await Profile.collection.insertOne({
      userId: user._id,
      summary: 'x'.repeat(2000),
      experience: [{ title: 'Old', company: 'Co', startDate: '', endDate: 'whenever' }],
      skills: { manual: ['y'.repeat(80)] },
    });
    const res = await request(app).get('/api/profile').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.profile.summary).toHaveLength(2000);
    expect(res.body.profile.experience[0].endDate).toBe('whenever');
  });
});

describe('imports go through validation', () => {
  test('CV import (Step 2 shape) needs real dates; years are accepted', async () => {
    const cvImport = {
      experience: [{ title: 'Engineer', company: 'Parsed Co', description: '', startDate: '', endDate: '', current: false, source: 'cv' }],
      education: [{ institution: 'Parsed Uni', degree: 'BSc', field: '', startDate: '2015', endDate: '2019', gpa: '', source: 'cv' }],
      skills: { manual: [], cv: ['Python', 'python'], extracted: [] },
      projects: { manual: [], github: [], cv: [{ name: 'Thesis', description: 'NLP', technologies: ['Python'] }], selected: [] },
      cvImportedAt: new Date().toISOString(),
      cvData: { parsedData: { skills: [] }, uploadDate: null, parsingStatus: 'verified' },
    };
    expect400(await put(cvImport), ['experience[0].startDate', 'experience[0].endDate']);

    cvImport.experience[0] = { ...cvImport.experience[0], startDate: '2019', endDate: '2021' };
    const res = await put(cvImport);
    expect(res.status).toBe(200);
    expect(res.body.profile.skills.cv).toEqual(['Python']);
    expect(res.body.profile.cvData.parsingStatus).toBe('verified');
  });

  test('CV import with an unknown CV status → 400', async () => {
    expect400(await put({ cvData: { parsingStatus: 'done' } }), ['cvData.parsingStatus']);
  });

  test('GitHub apply (Step 3 shape) is validated', async () => {
    const githubApply = {
      githubData: {
        username: 'octo-cat',
        repos: [{ repoId: 1, name: 'demo', url: 'https://github.com/octo-cat/demo' }],
        extractedSkills: ['JavaScript'],
        lastSynced: new Date().toISOString(),
      },
      projects: {
        manual: [],
        cv: [],
        selected: [],
        github: [{ repoId: 1, name: 'demo', description: '', url: 'https://github.com/octo-cat/demo', languages: ['JavaScript'], topics: [], stars: 0 }],
      },
      skills: { manual: [], cv: [], extracted: ['JavaScript', 'react'] },
    };
    expect((await put(githubApply)).status).toBe(200);
    githubApply.githubData.repos = 'not-a-list';
    expect400(await put(githubApply), ['githubData.repos']);
  });
});

describe('Mongoose errors are client errors (second line of defence)', () => {
  const fakeRes = () => {
    const res = { headersSent: false };
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };

  test('CastError → 400 VALIDATION_ERROR, logged as a warning without the value', async () => {
    const err = new mongoose.Error.CastError('Number', 'secret-value', 'projects.github.0.stars');
    const res = fakeRes();
    handleServerError(res, { requestId: 'cast-req-0001-abcd', method: 'PUT', originalUrl: '/api/profile' }, err, { module: 'profile' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toEqual({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Must be a valid number',
      errors: [{ field: 'projects.github[0].stars', message: 'Must be a valid number' }],
    });
    const entry = await waitFor(() => ErrorLog.findOne({ requestId: 'cast-req-0001-abcd' }).lean());
    expect(entry).toMatchObject({ level: 'warning', errorType: 'MONGOOSE_CAST_ERROR', statusCode: 400 });
    expect(entry.message).not.toContain('secret-value');
  });

  test('ValidationError from the model → 400 with paths', async () => {
    const doc = new Profile({ userId: user._id, experience: [{ title: '', company: 'x'.repeat(200) }] });
    const err = doc.validateSync();
    const res = fakeRes();
    handleServerError(res, { requestId: 'val-req-0001-abcd' }, err, { module: 'profile' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].errors.map((e) => e.field).sort()).toEqual(['experience[0].company', 'experience[0].title']);
  });
});
