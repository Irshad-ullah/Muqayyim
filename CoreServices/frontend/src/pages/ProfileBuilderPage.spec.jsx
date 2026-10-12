import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../services/profileService.js', () => ({
  profileService: { getProfile: vi.fn(), saveProfile: vi.fn(), fetchGitHub: vi.fn(), extractSkills: vi.fn() },
}));
vi.mock('../services/cvService.js', () => ({
  cvService: { getLatestCV: vi.fn(async () => ({ cvData: null, status: null })) },
}));
vi.mock('../components/Navbar.jsx', () => ({ default: () => null }));
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { name: 'Ada Lovelace' } }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const { profileService } = await import('../services/profileService.js');
const { default: ProfileBuilderPage } = await import('./ProfileBuilderPage.jsx');

const PROFILE = {
  personalInfo: { phone: '', location: '', website: '', linkedin: '', github: '' },
  summary: 'Developer',
  experience: [
    { title: 'Developer', company: 'Acme', startDate: '2019-01', endDate: '2020-06', current: false, description: '' },
    { title: 'Engineer', company: 'Globex', startDate: '2020-07', endDate: '2022-01', current: false, description: '' },
  ],
  education: [],
  skills: { manual: ['React'], cv: [], extracted: [] },
  certifications: [],
  projects: { manual: [], github: [], cv: [], selected: [] },
  githubData: { username: '', repos: [], extractedSkills: [] },
};

const serverError = (errors) =>
  Object.assign(new Error(errors[0].message), { status: 400, code: 'VALIDATION_ERROR', errors });

const renderPage = (path = '/profile-builder') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ProfileBuilderPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  profileService.getProfile.mockResolvedValue({ profile: structuredClone(PROFILE) });
});
afterEach(cleanup);

describe('ProfileBuilderPage — server validation errors', () => {
  test('an error on experience[1].endDate jumps to the CV step and shows under that field', async () => {
    const user = userEvent.setup();
    profileService.saveProfile.mockRejectedValue(
      serverError([{ field: 'experience[1].endDate', message: 'End date must be after the start date' }]),
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: /save profile/i }));

    // Jumped from Basic Info to the CV Import step.
    expect(await screen.findByRole('heading', { name: 'CV Import' })).toBeTruthy();

    const second = await screen.findByTestId('experience-1');
    const endDate = within(second).getByLabelText(/^End date/);
    expect(endDate.getAttribute('aria-invalid')).toBe('true');
    const message = document.getElementById(endDate.getAttribute('aria-describedby'));
    expect(message.textContent).toBe('End date must be after the start date');
    expect(within(second).getByRole('alert').textContent).toBe('End date must be after the start date');

    // Only the second entry is marked.
    expect(within(screen.getByTestId('experience-0')).queryByRole('alert')).toBeNull();
    // The step summary lists it with a readable label.
    expect(within(screen.getByTestId('step-errors')).getByText(/Experience 2 › End date/)).toBeTruthy();
  });

  test('client checks block the save and point at the field before calling the server', async () => {
    const user = userEvent.setup();
    const bad = structuredClone(PROFILE);
    bad.experience[1].startDate = '2023-01';
    profileService.getProfile.mockResolvedValue({ profile: bad });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /save profile/i }));

    const endDate = within(await screen.findByTestId('experience-1')).getByLabelText(/^End date/);
    expect(endDate.getAttribute('aria-invalid')).toBe('true');
    expect(profileService.saveProfile).not.toHaveBeenCalled();
  });

  test('editing the section clears its errors', async () => {
    const user = userEvent.setup();
    profileService.saveProfile.mockRejectedValue(
      serverError([{ field: 'experience[1].endDate', message: 'End date must be after the start date' }]),
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: /save profile/i }));
    const endDate = within(await screen.findByTestId('experience-1')).getByLabelText(/^End date/);
    await user.type(endDate, '1');
    await waitFor(() => expect(within(screen.getByTestId('experience-1')).queryByRole('alert')).toBeNull());
  });

  test('?step=skills opens that step', async () => {
    renderPage('/profile-builder?step=skills');
    expect(await screen.findByRole('heading', { name: 'Skills' })).toBeTruthy();
  });
});
