import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/taxonomyService.js', () => ({
  taxonomyService: {
    listJobs: vi.fn(),
    getJob: vi.fn(),
    getDiff: vi.fn(),
    preview: vi.fn(),
    cancel: vi.fn(),
    publish: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const { taxonomyService } = await import('../../../services/taxonomyService.js');
const { default: PreviewPublishTab } = await import('./PreviewPublishTab.jsx');

const base = {
  job_id: 'j1', source: 'esco', dataset_version: 'ESCO v1.2.1', created_by: 'admin-1', created_at: '2026-10-16T09:00:00Z',
  updated_at: '2026-10-16T09:05:00Z', file_summary: { upload_bytes: 1024, validated_files: { 'skills_en.csv': { bytes: 2048, rows: 13960 } } },
  validation_errors: [], progress: { message: 'Files received' },
};
const DIFF = {
  counts: { professions_added: 1, professions_removed: 0, professions_changed: 2, links_added: 3, links_removed: 0, new_undescribed_skills: 0 },
  samples: { professions_added: [{ title: 'Data engineer' }], professions_changed: [], links_added: [], professions_removed: [], links_removed: [], new_undescribed_skills: [] },
  kept_admin_overrides: 1, categories: {}, active_professions: { live: 143, staged: 144 },
};
const passedChecks = { background_warning: false, background: { check: { chef_pooled_pct: 3.0, web_pooled_pct: 12.2, passed: true } } };
const warnChecks = {
  background_warning: true,
  background: { check: { chef_pooled_pct: 9.4, web_pooled_pct: 11.8, chef_to_web: 0.8, criteria: 'chef <= 5.0% and chef <= 0.5 x web', passed: false } },
};
const job = (overrides) => ({ ...base, ...overrides });
const httpError = (status, data = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers: {} } });

const renderTab = (props = {}) =>
  render(<PreviewPublishTab lock={null} refreshLock={vi.fn()} setLock={vi.fn()} selectedJobId="j1" onSelectJob={vi.fn()} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
  taxonomyService.listJobs.mockResolvedValue({ data: [base] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PreviewPublishTab — ESCO role map (Module 5.1)', () => {
  test('the preview shows adjusted requirements, unmapped essential phrases and stale entries, and flags a drop', async () => {
    const roleMap = { live_adjusted: 846, staged_adjusted: 840, dropped: true, essential_not_in_map: 12,
      essential_reviewed_unmapped: 1314, stale_entries: 6, stale_mapped_entries: 6 };
    taxonomyService.getJob.mockResolvedValue({ data: job({ status: 'previewed', diff_summary: { ...DIFF, role_map: roleMap }, checks: passedChecks }) });
    renderTab();
    const box = await screen.findByTestId('role-map-summary');
    expect(box.textContent).toContain('ESCO requirements adjusted by the role map: 846 → 840');
    expect(box.textContent).toContain('fewer than now');
    expect(box.textContent).toContain('Essential phrases not in the map: 12');
    expect(box.textContent).toContain('reviewed and left unmapped: 1314');
    expect(box.textContent).toContain('stale map entries: 6');
  });

  test('no drop, no warning', async () => {
    const roleMap = { live_adjusted: 0, staged_adjusted: 846, dropped: false, essential_not_in_map: 0, essential_reviewed_unmapped: 1314, stale_entries: 0 };
    taxonomyService.getJob.mockResolvedValue({ data: job({ status: 'previewed', diff_summary: { ...DIFF, role_map: roleMap }, checks: passedChecks }) });
    renderTab();
    const box = await screen.findByTestId('role-map-summary');
    expect(box.textContent).toContain('0 → 846');
    expect(box.textContent).not.toContain('fewer than now');
  });
});

describe('PreviewPublishTab — states', () => {
  test('loading, then the job list and the selected job', async () => {
    taxonomyService.getJob.mockResolvedValue({ data: job({ status: 'validated' }) });
    renderTab();
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
    const detail = await screen.findByTestId('job-detail');
    expect(within(detail).getByText('skills_en.csv')).toBeTruthy();
    expect(within(detail).getByText('13,960')).toBeTruthy();
    expect(screen.getAllByTestId('job-row')).toHaveLength(1);
  });

  test('empty: no jobs yet', async () => {
    taxonomyService.listJobs.mockResolvedValue({ data: [] });
    renderTab({ selectedJobId: null });
    expect(await screen.findByText(/No import jobs yet/)).toBeTruthy();
  });

  test('error: the job list cannot load (AI down → 503)', async () => {
    taxonomyService.listJobs.mockRejectedValue(httpError(503, { code: 'TAXONOMY_UNAVAILABLE' }));
    renderTab({ selectedJobId: null });
    expect(await screen.findByText(/AI service is not reachable/)).toBeTruthy();
  });

  test('failed validation lists the errors', async () => {
    taxonomyService.getJob.mockResolvedValue({
      data: job({ status: 'failed', error: 'Validation failed', validation_errors: ['Missing required file(s): skills_en.csv. ESCO needs …'] }),
    });
    renderTab();
    expect(await screen.findByText(/Missing required file\(s\): skills_en.csv/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull();
  });

  test('validated: Run preview starts the preview', async () => {
    const user = userEvent.setup();
    taxonomyService.getJob.mockResolvedValue({ data: job({ status: 'validated' }) });
    taxonomyService.preview.mockResolvedValue({ data: job({ status: 'previewing', progress: { message: 'Building staged data' } }) });
    renderTab();
    await user.click(await screen.findByRole('button', { name: /Run preview/ }));
    expect(taxonomyService.preview).toHaveBeenCalledWith('j1');
    expect(await screen.findByTestId('job-progress')).toBeTruthy();
  });

  test('success: published job says how to undo it', async () => {
    taxonomyService.getJob.mockResolvedValue({ data: job({ status: 'published', snapshot_id: 's-1', diff_summary: DIFF, checks: passedChecks }) });
    renderTab();
    expect((await screen.findByTestId('published-note')).textContent).toMatch(/Snapshot s-1/);
  });

  test('a 409 from the server is shown clearly', async () => {
    const user = userEvent.setup();
    taxonomyService.getJob.mockResolvedValue({ data: job({ status: 'previewed', diff_summary: DIFF, checks: passedChecks }) });
    taxonomyService.publish.mockRejectedValue(httpError(409, { code: 'LIVE_DATA_CHANGED' }));
    renderTab();
    await user.click(await screen.findByRole('button', { name: /Publish/ }));
    expect(await screen.findByText(/Run the preview again before publishing/)).toBeTruthy();
  });

  test('a 409 busy passes the lock up so the banner shows it', async () => {
    const user = userEvent.setup();
    const setLock = vi.fn();
    taxonomyService.getJob.mockResolvedValue({ data: job({ status: 'validated' }) });
    taxonomyService.cancel.mockRejectedValue(httpError(409, { code: 'TAXONOMY_BUSY', lock: { owner: 'job:j2', actor: 'admin-2' } }));
    renderTab({ setLock });
    await user.click(await screen.findByRole('button', { name: /Cancel job/ }));
    expect(await screen.findByText(/Publishing an import \(by admin-2\)/)).toBeTruthy();
    expect(setLock).toHaveBeenCalledWith({ owner: 'job:j2', actor: 'admin-2' });
  });
});

describe('PreviewPublishTab — publish button rules', () => {
  test('no warning: Publish is enabled and sends no acknowledgement', async () => {
    const user = userEvent.setup();
    taxonomyService.getJob.mockResolvedValue({ data: job({ status: 'previewed', diff_summary: DIFF, checks: passedChecks }) });
    taxonomyService.publish.mockResolvedValue({ data: job({ status: 'publishing' }) });
    renderTab();
    const publish = await screen.findByRole('button', { name: /Publish/ });
    expect(publish.disabled).toBe(false);
    expect(screen.queryByTestId('background-warning')).toBeNull();
    await user.click(publish);
    expect(taxonomyService.publish).toHaveBeenCalledWith('j1', false);
  });

  test('warning: amber box with chef and web rates; Publish disabled until “I understand” is ticked', async () => {
    const user = userEvent.setup();
    taxonomyService.getJob.mockResolvedValue({ data: job({ status: 'previewed', diff_summary: DIFF, checks: warnChecks }) });
    taxonomyService.publish.mockResolvedValue({ data: job({ status: 'publishing' }) });
    renderTab();
    const warning = await screen.findByTestId('background-warning');
    expect(warning.className).toMatch(/amber/);
    expect(warning.textContent).toMatch(/9\.4 %/);
    expect(warning.textContent).toMatch(/11\.8 %/);
    const publish = screen.getByRole('button', { name: /Publish/ });
    expect(publish.disabled).toBe(true);
    expect(screen.getByTestId('publish-reason').textContent).toMatch(/I understand/);
    await user.click(within(warning).getByRole('checkbox'));
    expect(publish.disabled).toBe(false);
    await user.click(publish);
    expect(taxonomyService.publish).toHaveBeenCalledWith('j1', true);
  });

  test('check unavailable is also a warning that needs the tick', async () => {
    taxonomyService.getJob.mockResolvedValue({
      data: job({ status: 'previewed', diff_summary: DIFF, checks: { background_warning: true, background: { error: 'The embedding model did not become ready in time' } } }),
    });
    renderTab();
    expect((await screen.findByTestId('background-warning')).textContent).toMatch(/could not run/);
    expect(screen.getByRole('button', { name: /Publish/ }).disabled).toBe(true);
  });

  test('while the lock is held every changing button is disabled, even after the tick', async () => {
    const user = userEvent.setup();
    taxonomyService.getJob.mockResolvedValue({ data: job({ status: 'previewed', diff_summary: DIFF, checks: warnChecks }) });
    renderTab({ lock: { owner: 'edit:skill', actor: 'admin-2' } });
    const warning = await screen.findByTestId('background-warning');
    expect(within(warning).getByRole('checkbox').disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Publish/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Cancel job/ }).disabled).toBe(true);
    await user.click(within(warning).getByRole('checkbox'));
    expect(taxonomyService.publish).not.toHaveBeenCalled();
  });
});

describe('PreviewPublishTab — polling', () => {
  test('polls every 2 s while the job runs and stops when it finishes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const refreshLock = vi.fn();
    taxonomyService.getJob
      .mockResolvedValueOnce({ data: job({ status: 'previewing' }) })
      .mockResolvedValueOnce({ data: job({ status: 'previewing' }) })
      .mockResolvedValue({ data: job({ status: 'previewed', diff_summary: DIFF, checks: passedChecks }) });
    renderTab({ refreshLock });
    await screen.findByTestId('job-progress');
    expect(taxonomyService.getJob).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(2000));
    await waitFor(() => expect(taxonomyService.getJob).toHaveBeenCalledTimes(2));
    await act(async () => vi.advanceTimersByTime(2000));
    await screen.findByTestId('diff-summary');
    expect(taxonomyService.getJob).toHaveBeenCalledTimes(3);
    expect(refreshLock).toHaveBeenCalled(); // the job finished: lock and list refreshed

    await act(async () => vi.advanceTimersByTime(10000));
    expect(taxonomyService.getJob).toHaveBeenCalledTimes(3); // no more polling
  });

  test('a just-uploaded job is polled until it is validated', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    taxonomyService.getJob
      .mockResolvedValueOnce({ data: job({ status: 'uploaded' }) })
      .mockResolvedValue({ data: job({ status: 'validated' }) });
    renderTab();
    await screen.findByTestId('job-progress');
    await act(async () => vi.advanceTimersByTime(2000));
    expect(await screen.findByRole('button', { name: /Run preview/ })).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(10000));
    expect(taxonomyService.getJob).toHaveBeenCalledTimes(2);
  });

  test('does not poll while the browser tab is hidden', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    taxonomyService.getJob.mockResolvedValue({ data: job({ status: 'publishing' }) });
    renderTab();
    await screen.findByTestId('job-progress');
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => vi.advanceTimersByTime(10000));
    expect(taxonomyService.getJob).toHaveBeenCalledTimes(1);

    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(taxonomyService.getJob).toHaveBeenCalledTimes(2)); // polled at once on return
    await act(async () => vi.advanceTimersByTime(2000));
    await waitFor(() => expect(taxonomyService.getJob).toHaveBeenCalledTimes(3));
    hidden.mockRestore();
  });

  test('does not poll a job that is not running', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    taxonomyService.getJob.mockResolvedValue({ data: job({ status: 'validated' }) });
    renderTab();
    await screen.findByRole('button', { name: /Run preview/ });
    await act(async () => vi.advanceTimersByTime(10000));
    expect(taxonomyService.getJob).toHaveBeenCalledTimes(1);
  });
});
