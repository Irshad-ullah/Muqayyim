import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDb, dropTestDb } from './helpers.js';

// The CV generator source falls back to the parsed CV (AIServices) when the
// profile has no entries; newer parses carry dates, certifications and links.
const getLatestParsedCv = jest.fn();
jest.unstable_mockModule('../backend/services/aiServiceClient.js', () => ({ getLatestParsedCv }));

const { buildCvSource } = await import('../backend/services/cvSourceService.js');
const { default: User } = await import('../backend/models/User.js');
const { validateProfileUpdate } = await import('../backend/validation/profileSchemas.js');

let user;
beforeAll(async () => {
  await connectTestDb();
  user = await User.create({ name: 'Parsed Source', email: `src${Date.now()}@example.com`, password: 'abcd1234' });
});
afterAll(dropTestDb);

test('parsed dates, certifications and project links reach the CV source', async () => {
  getLatestParsedCv.mockResolvedValue({
    parsing_status: 'parsed',
    parsed_data: {
      skills: [{ name: 'React' }],
      experience: [
        { title: 'Engineer', company: 'Acme', location: 'Lahore', startDate: '2022-01', endDate: '', current: true, description: 'Built APIs', duration: 'Jan 2022 – Present' },
        { title: 'Old', company: 'Legacy', duration: '2018 - 2019' }, // older parse: duration only
      ],
      education: [{ degree: 'BS', field: 'CS', institution: 'FAST', startDate: '2016', endDate: '2020', gpa: '3.4' }],
      certifications: [{ name: 'AWS Cloud Practitioner', issuer: 'Amazon Web Services', date: '2023', url: '' }],
      projects: [{ name: 'Muqayyim', description: 'Career platform', technologies: ['React'], githubUrl: 'https://github.com/a/muqayyim', liveUrl: 'https://muqayyim.example.com' }],
    },
  });
  const { data } = await buildCvSource(new mongoose.Types.ObjectId(user._id));
  expect(data.experience[0]).toMatchObject({ startDate: '2022-01', endDate: '', current: true, location: 'Lahore', description: 'Built APIs' });
  expect(data.experience[1]).toMatchObject({ startDate: '2018', endDate: '2019', current: false });
  expect(data.education[0]).toMatchObject({ field: 'CS', startDate: '2016', endDate: '2020', gpa: '3.4' });
  expect(data.certifications[0]).toMatchObject({ name: 'AWS Cloud Practitioner', issuer: 'Amazon Web Services', date: '2023' });
  expect(data.projects[0]).toMatchObject({ url: 'https://github.com/a/muqayyim', liveUrl: 'https://muqayyim.example.com' });
});

test('profile projects.cv accepts a validated url', () => {
  const ok = validateProfileUpdate({ projects: { cv: [{ name: 'Muqayyim', url: 'github.com/a/muqayyim' }] } });
  expect(ok.errors).toEqual([]);
  expect(ok.data.projects.cv[0].url).toBe('https://github.com/a/muqayyim');
  const bad = validateProfileUpdate({ projects: { cv: [{ name: 'X', url: 'https://github.com/onlyowner' }] } });
  expect(bad.errors.map((e) => e.field)).toEqual(['projects.cv[0].url']);
});
