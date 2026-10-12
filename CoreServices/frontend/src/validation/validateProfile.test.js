import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeField, splitDateRange, stepForField, validateProfile } from './validateProfile.js';
import { missingForGeneration, validateCvFields } from '../components/cvgen/cvModel.js';

test('CV import durations become stored dates', () => {
  assert.deepEqual(splitDateRange('Jan 2020 - Present'), { startDate: '2020-01', endDate: '', current: true });
  assert.deepEqual(splitDateRange('2019 – 2021'), { startDate: '2019', endDate: '2021', current: false });
  assert.deepEqual(splitDateRange('03/2020 to 06/2022'), { startDate: '2020-03', endDate: '2022-06', current: false });
  assert.deepEqual(splitDateRange('2023'), { startDate: '2023', endDate: '', current: false });
  assert.equal(splitDateRange('a few years'), null);
});

test('errors map to wizard steps and readable labels', () => {
  assert.equal(stepForField('experience[1].endDate'), 'cv');
  assert.equal(stepForField('personalInfo.phone'), 'basic');
  assert.equal(stepForField('skills.cv[0]'), 'skills');
  assert.equal(stepForField('projects.manual[2].url'), 'projects');
  assert.equal(stepForField('githubData.username'), 'github');
  assert.equal(describeField('experience[1].endDate'), 'Experience 2 › End date');
  assert.equal(describeField('skills.cv[0]'), 'Skills › From CV 1');
});

test('validateProfile only checks the sections present', () => {
  assert.deepEqual(validateProfile({ summary: 'ok' }), []);
  assert.deepEqual(
    validateProfile({ summary: 'x'.repeat(501) }).map((e) => e.field),
    ['summary'],
  );
});

test('FR6.8 completeness on the client matches the server rule', () => {
  assert.deepEqual(missingForGeneration({ personal: { fullName: ' ' }, summary: 'only a summary' }), [
    'name',
    'experience',
    'education',
    'projects',
    'skills',
  ]);
  assert.deepEqual(missingForGeneration({ personal: { fullName: 'Ada' }, skills: [{ items: ['Go'] }] }), []);
});

test('CV content uses the profile rules', () => {
  const fields = validateCvFields({
    personal: { fullName: 'A', linkedin: 'javascript:x' },
    experience: [{ title: 'Dev', company: '', startDate: '2022-01', endDate: '2021-01' }],
    projects: [{ name: 'P', liveUrl: 'ftp://x.com' }],
  }).map((e) => e.field);
  assert.deepEqual(fields.sort(), [
    'experience[0].company',
    'experience[0].endDate',
    'personal.fullName',
    'personal.linkedin',
    'projects[0].liveUrl',
  ]);
});
