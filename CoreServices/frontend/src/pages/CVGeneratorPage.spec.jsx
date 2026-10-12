import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../components/Navbar.jsx', () => ({ default: () => null }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const { IncompleteNotice } = await import('./CVGeneratorPage.jsx');

afterEach(cleanup);

const renderNotice = (missing) =>
  render(
    <MemoryRouter>
      <IncompleteNotice missing={missing} />
    </MemoryRouter>,
  );

describe('CV generator — PROFILE_INCOMPLETE', () => {
  test('links each missing piece to where it is added', () => {
    renderNotice(['name', 'experience', 'education', 'projects', 'skills']);
    const notice = screen.getByTestId('profile-incomplete');
    expect(within(notice).getByRole('link', { name: /your name/i }).getAttribute('href')).toBe('/profile');
    expect(within(notice).getByRole('link', { name: /work experience/i }).getAttribute('href')).toBe('/profile-builder?step=cv');
    expect(within(notice).getByRole('link', { name: /projects/i }).getAttribute('href')).toBe('/profile-builder?step=projects');
    expect(within(notice).getByRole('link', { name: /skills/i }).getAttribute('href')).toBe('/profile-builder?step=skills');
  });

  test('only the name missing → one link', () => {
    renderNotice(['name']);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  test('nothing missing → nothing rendered', () => {
    renderNotice([]);
    expect(screen.queryByTestId('profile-incomplete')).toBeNull();
  });
});
