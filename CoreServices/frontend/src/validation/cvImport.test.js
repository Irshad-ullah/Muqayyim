import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapParsedCvToProfile, validateParsedCv } from './cvImport.js';
import { validateProfile } from './validateProfile.js';

const all = (arr) => Object.fromEntries((arr || []).map((_, i) => [i, true]));
const select = (cv) => ({
  experience: all(cv.experience),
  education: all(cv.education),
  skills: all(cv.skills),
  projects: all(cv.projects),
  certifications: all(cv.certifications),
});
const EMPTY_PROFILE = { experience: [], education: [], certifications: [], skills: { manual: [], cv: [], extracted: [] }, projects: { manual: [], github: [], cv: [], selected: [] } };

const NEW_PARSE = {
  skills: [{ name: 'React' }],
  experience: [
    { title: 'Software Engineer', company: 'Systems Ltd', location: 'Lahore', startDate: '2022-01', endDate: '', current: true, description: 'Built APIs', needsReview: [] },
    { title: 'Intern', company: 'TechCorp', startDate: '', endDate: '', current: false, needsReview: ['startDate', 'endDate'] },
  ],
  education: [{ degree: 'BS', field: 'Computer Science', institution: 'FAST NUCES', startDate: '2016', endDate: '2020', gpa: '3.4' }],
  certifications: [
    { name: 'AWS Cloud Practitioner', issuer: 'Amazon Web Services', date: '2023' },
    { name: 'ML Specialization', issuer: '', date: '', needsReview: ['issuer'] },
  ],
  projects: [{ name: 'Muqayyim', description: 'Platform', technologies: ['React'], githubUrl: 'https://github.com/a/muqayyim', liveUrl: '' }],
};

test('new parses carry dates, current flags, certifications and links into the profile', () => {
  const out = mapParsedCvToProfile(NEW_PARSE, select(NEW_PARSE), EMPTY_PROFILE);
  assert.deepEqual(out.experience[0], {
    title: 'Software Engineer', company: 'Systems Ltd', location: 'Lahore', description: 'Built APIs',
    startDate: '2022-01', endDate: '', current: true, source: 'cv',
  });
  assert.equal(out.education[0].field, 'Computer Science');
  assert.equal(out.education[0].gpa, '3.4');
  assert.deepEqual(out.certifications.map((c) => c.name), ['AWS Cloud Practitioner', 'ML Specialization']);
  assert.equal(out.projects.cv[0].url, 'https://github.com/a/muqayyim');
});

test('the imported profile fails validation only on the fields the parser flagged', () => {
  const out = mapParsedCvToProfile(NEW_PARSE, select(NEW_PARSE), EMPTY_PROFILE);
  const fields = validateProfile(out).map((e) => e.field).sort();
  assert.deepEqual(fields, ['certifications[1].issuer', 'experience[1].endDate', 'experience[1].startDate']);
});

test('older parses (duration / year only) still map to dates', () => {
  const old = {
    experience: [{ title: 'Dev', company: 'A', duration: 'Jan 2020 - Present' }, { title: 'QA', company: 'B', duration: 'a few months' }],
    education: [{ degree: 'BS', institution: 'U', year: '2016 - 2020' }],
  };
  const out = mapParsedCvToProfile(old, select(old), EMPTY_PROFILE);
  assert.deepEqual([out.experience[0].startDate, out.experience[0].current], ['2020-01', true]);
  assert.equal(out.experience[1].description, 'a few months'); // unparseable → kept visible
  assert.deepEqual([out.education[0].startDate, out.education[0].endDate], ['2016', '2020']);
});

test('manual entries are kept and not duplicated; unselected items are skipped', () => {
  const profile = { ...EMPTY_PROFILE, experience: [{ title: 'Software Engineer', company: 'Systems Ltd', source: 'manual' }] };
  const sel = { ...select(NEW_PARSE), certifications: { 0: true } };
  const out = mapParsedCvToProfile(NEW_PARSE, sel, profile);
  assert.deepEqual(out.experience.map((e) => e.source), ['manual', 'cv']);
  assert.equal(out.certifications.length, 1);
});

test('validateParsedCv uses the verify paths', () => {
  const fields = validateParsedCv({
    ...NEW_PARSE,
    projects: [{ name: 'P', githubUrl: 'https://github.com/onlyowner', liveUrl: 'ftp://x.com' }],
  }).map((e) => e.field).sort();
  assert.deepEqual(fields, [
    'certifications[1].issuer',
    'experience[1].endDate',
    'experience[1].startDate',
    'projects[0].githubUrl',
    'projects[0].liveUrl',
  ]);
});
