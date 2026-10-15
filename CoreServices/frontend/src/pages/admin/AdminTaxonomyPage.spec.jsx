import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/taxonomyService.js', () => ({
  taxonomyService: {
    getLock: vi.fn(),
    getSources: vi.fn(),
    listJobs: vi.fn(),
    getJob: vi.fn(),
    listSnapshots: vi.fn(),
    listRestores: vi.fn(),
    listProfessions: vi.fn(),
    listSkills: vi.fn(),
  },
}));
vi.mock('../../components/admin/AdminLayout.jsx', () => ({
  default: ({ children, title }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const { taxonomyService } = await import('../../services/taxonomyService.js');
const { default: AdminTaxonomyPage } = await import('./AdminTaxonomyPage.jsx');

const SOURCES = {
  onet: { versions: [], professions: 0, active: 0, last_published_job: null },
  esco: { versions: [], professions: 0, active: 0, last_published_job: null },
  manual: { professions: 0, active: 0 },
};
const LOCK = { owner: 'job:j1', actor: 'admin-2', job_id: 'j1', acquired_at: '2026-10-16T10:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  taxonomyService.getLock.mockResolvedValue({ data: null });
  taxonomyService.getSources.mockResolvedValue({ data: SOURCES });
  taxonomyService.listJobs.mockResolvedValue({ data: [] });
  taxonomyService.listSnapshots.mockResolvedValue({ data: [] });
  taxonomyService.listRestores.mockResolvedValue({ data: [] });
  taxonomyService.listProfessions.mockResolvedValue({ data: [], categories: [] });
  taxonomyService.listSkills.mockResolvedValue({ data: [], categories: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AdminTaxonomyPage', () => {
  test('five tabs; Data sources first', async () => {
    const user = userEvent.setup();
    render(<AdminTaxonomyPage />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent.trim());
    expect(tabs).toEqual(['Data sources', 'Preview & publish', 'History', 'Professions', 'Skill taxonomy']);
    expect(await screen.findByTestId('source-onet')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /History/ }));
    expect(await screen.findByText(/No snapshots yet/)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /Skill taxonomy/ }));
    expect(await screen.findByText('No skills match.')).toBeTruthy();
  });

  test('no banner while the lock is free, and no lock polling', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    render(<AdminTaxonomyPage />);
    await screen.findByTestId('source-onet');
    expect(screen.queryByTestId('lock-banner')).toBeNull();
    await act(async () => vi.advanceTimersByTime(10000));
    expect(taxonomyService.getLock).toHaveBeenCalledTimes(1);
  });

  test('the banner says who holds the lock and what for; polled every 2 s until released', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    taxonomyService.getLock.mockResolvedValueOnce({ data: LOCK }).mockResolvedValueOnce({ data: LOCK }).mockResolvedValue({ data: null });
    render(<AdminTaxonomyPage />);
    const banner = await screen.findByTestId('lock-banner');
    expect(banner.textContent).toMatch(/Publishing an import — by admin-2/);
    await act(async () => vi.advanceTimersByTime(2000));
    await waitFor(() => expect(taxonomyService.getLock).toHaveBeenCalledTimes(2));
    await act(async () => vi.advanceTimersByTime(2000));
    await waitFor(() => expect(screen.queryByTestId('lock-banner')).toBeNull());
    await act(async () => vi.advanceTimersByTime(10000));
    expect(taxonomyService.getLock).toHaveBeenCalledTimes(3);
  });
});
