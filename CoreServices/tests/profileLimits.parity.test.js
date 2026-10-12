import { readFileSync } from 'fs';
import { LIMITS } from '../backend/validation/profileLimits.js';
import * as serverRules from '../backend/validation/rules.js';
import { validateProfileUpdate } from '../backend/validation/profileSchemas.js';
import { PROFILE_LIMITS as frontendLimits } from '../frontend/src/constants/profileLimits.js';
import * as clientRules from '../frontend/src/validation/profileRules.js';
import { validateProfile } from '../frontend/src/validation/validateProfile.js';

// Server and frontend must apply the same limits and rules. AIServices has
// its own parity test (tests/test_profile_limits.py) against the same JSON.

describe('limits parity', () => {
  test('frontend constants equal backend/validation/profileLimits.json', () => {
    expect(frontendLimits).toEqual(LIMITS);
  });

  test('frontend profileRules.js is the backend rules.js (only the import differs)', () => {
    const body = (path) => {
      const src = readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
      return src.slice(src.indexOf('// Each checker returns'));
    };
    expect(body('../frontend/src/validation/profileRules.js')).toBe(body('../backend/validation/rules.js'));
  });

  test.each([
    ['parseDate', ['Jan 2020', '2021-06-15T00:00:00Z', '03/2019', '2019', 'Present', 'soon', '2020-13', '']],
    ['normalizeUrl', ['linkedin.com/in/x', 'javascript:alert(1)', 'HTTPS://WWW.github.com/a', 'http://x', '']],
    ['checkPhone', ['+92 300 1234567', '12345', '(+) ---- 1', '']],
    ['checkGithubUsername', ['octo-cat', '-x', 'a--b', 'x'.repeat(40)]],
    ['checkSkillName', [' React ', 'x'.repeat(51), 42]],
  ])('%s behaves the same on both sides', (fn, inputs) => {
    inputs.forEach((input) => expect(clientRules[fn](input)).toEqual(serverRules[fn](input)));
  });
});

// Every fixture must produce the same error fields on the client and server.
const job = (over = {}) => ({ title: 'Dev', company: 'Acme', startDate: '2020-01', endDate: '2021-01', ...over });
const FIXTURES = [
  { summary: 'ok' },
  { summary: 'x'.repeat(501) },
  { summary: 7 },
  { personalInfo: { phone: '123', website: 'ftp://x.com', linkedin: 'linkedin.com/in/me', location: 'x'.repeat(101) } },
  { experience: [job(), job({ title: '', startDate: '', endDate: '' })] },
  { experience: [job({ startDate: '2022-05', endDate: '2021-01' }), job({ current: true, endDate: '' }), job({ endDate: 'Present' })] },
  { experience: [job({ startDate: '2999-01', current: true })] },
  { experience: [job({ startDate: 'whenever' })] },
  { experience: 'nope' },
  { experience: Array.from({ length: 31 }, () => job()) },
  { education: [{ institution: '', degree: '', startDate: '2020', endDate: '2019' }] },
  { certifications: [{ name: 'A', issuer: '', url: 'javascript:x', date: '2999-01' }] },
  { skills: { manual: ['React', 'x'.repeat(51)], cv: ['react'], extracted: 5 } },
  { skills: { manual: Array.from({ length: 101 }, (_, i) => `s${i}`) } },
  {
    projects: {
      manual: [{ name: '', url: 'https://github.com/owner' }, { name: 'ok', description: 'x'.repeat(1001), technologies: ['y'.repeat(51)] }],
      github: [{ name: 'r', url: 'https://gitlab.com/a/b' }],
      cv: [{ name: '' }],
    },
  },
  { githubData: { username: 'bad--name' } },
];

describe('client validator mirrors the server', () => {
  test.each(FIXTURES.map((f) => [JSON.stringify(f).slice(0, 80), f]))('%s', (_, fixture) => {
    const server = validateProfileUpdate(fixture).errors.map((e) => e.field).filter((f) => !f.startsWith('projects.selected'));
    const client = validateProfile(fixture).map((e) => e.field);
    expect([...new Set(client)].sort()).toEqual([...new Set(server)].sort());
  });
});
