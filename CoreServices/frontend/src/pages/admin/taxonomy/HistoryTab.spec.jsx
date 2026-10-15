import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/taxonomyService.js', () => ({
  taxonomyService: {
    listSnapshots: vi.fn(),
    listRestores: vi.fn(),
    listJobs: vi.fn(),
    getSnapshot: vi.fn(),
    restore: vi.fn(),
    getRestore: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const { taxonomyService } = await import('../../../services/taxonomyService.js');
const { default: HistoryTab } = await import('./HistoryTab.jsx');

const SNAP = {
  snapshot_id: 's-pub', created_at: '2026-10-15T10:00:00Z', created_by: 'admin-1', reason: 'publish', pool: 'publish',
  counts: { active_professions: 143 }, source_versions: { onet: ['31.0'], esco: ['v1.2.1'] }, size_bytes: 3 * 1024 * 1024, note: null,
};
const UNDONE = {
  snapshot: SNAP,
  imports_undone: [{ job_id: 'j1', source: 'onet', dataset_version: 'O*NET 31.0', created_by: 'admin-1', updated_at: '2026-10-15T10:01:00Z' }],
  edits_undone: [
    { snapshot_id: 'e1', created_by: 'admin-2', created_at: '2026-10-15T11:00:00Z', note: 'profession "Software Developers" (onet:15-1252.00): title' },
    { snapshot_id: 'e2', created_by: 'admin-2', created_at: '2026-10-15T12:00:00Z', note: 'skill "Kafka": description' },
  ],
  restores_after: [],
};
const httpError = (status, data = {}, headers = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers } });

const renderTab = (props = {}) => render(<HistoryTab lock={null} refreshLock={vi.fn()} setLock={vi.fn()} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
  taxonomyService.listSnapshots.mockResolvedValue({ data: [SNAP] });
  taxonomyService.listRestores.mockResolvedValue({ data: [] });
  taxonomyService.listJobs.mockResolvedValue({ data: [] });
  taxonomyService.getSnapshot.mockResolvedValue({ data: UNDONE });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HistoryTab', () => {
  test('loading, then the snapshots', async () => {
    renderTab();
    expect(screen.getByText('Loading…')).toBeTruthy();
    const row = await screen.findByTestId('snapshot-row');
    expect(within(row).getByText('Before publish')).toBeTruthy();
    expect(within(row).getByText(/O\*NET 31.0 · ESCO v1.2.1/)).toBeTruthy();
  });

  test('empty: no snapshots yet', async () => {
    taxonomyService.listSnapshots.mockResolvedValue({ data: [] });
    renderTab();
    expect(await screen.findByText(/No snapshots yet/)).toBeTruthy();
  });

  test('error: history cannot load', async () => {
    taxonomyService.listSnapshots.mockRejectedValue(httpError(403, { code: 'FORBIDDEN' }));
    renderTab();
    expect(await screen.findByText(/Only administrators/)).toBeTruthy();
  });

  test('restore dialog lists exactly what is undone and needs RESTORE typed', async () => {
    const user = userEvent.setup();
    taxonomyService.restore.mockResolvedValue({ data: { restore_id: 'r1', status: 'restoring' } });
    renderTab();
    await user.click(await screen.findByRole('button', { name: /Restore…/ }));
    const dialog = await screen.findByRole('dialog');
    const undone = await within(dialog).findByTestId('undone-list');
    expect(taxonomyService.getSnapshot).toHaveBeenCalledWith('s-pub');
    expect(undone.textContent).toMatch(/Imports \(1\)/);
    expect(undone.textContent).toMatch(/O\*NET O\*NET 31.0, published by admin-1/);
    expect(undone.textContent).toMatch(/Edits \(2\)/);
    expect(undone.textContent).toContain('profession "Software Developers" (onet:15-1252.00): title — by admin-2');
    expect(undone.textContent).toContain('skill "Kafka": description — by admin-2');

    const confirm = within(dialog).getByRole('button', { name: 'Restore' });
    expect(confirm.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText('Confirmation word'), 'restore');
    expect(confirm.disabled).toBe(true); // must be the exact word
    await user.clear(within(dialog).getByLabelText('Confirmation word'));
    await user.type(within(dialog).getByLabelText('Confirmation word'), 'RESTORE');
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    expect(taxonomyService.restore).toHaveBeenCalledWith('s-pub');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('nothing to undo is said plainly', async () => {
    const user = userEvent.setup();
    taxonomyService.getSnapshot.mockResolvedValue({ data: { snapshot: SNAP, imports_undone: [], edits_undone: [], restores_after: [] } });
    renderTab();
    await user.click(await screen.findByRole('button', { name: /Restore…/ }));
    expect(await screen.findByText(/Nothing — no imports or edits/)).toBeTruthy();
  });

  test('a refused restore (429) stays in the dialog with the reason', async () => {
    const user = userEvent.setup();
    taxonomyService.restore.mockRejectedValue(httpError(429, { code: 'RATE_LIMITED' }, { 'retry-after': '120' }));
    renderTab();
    await user.click(await screen.findByRole('button', { name: /Restore…/ }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('undone-list');
    await user.type(within(dialog).getByLabelText('Confirmation word'), 'RESTORE');
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(await within(dialog).findByText(/Try again in 2 minutes/)).toBeTruthy();
  });

  test('restore buttons are disabled while the lock is held', async () => {
    renderTab({ lock: { owner: 'job:j2', actor: 'admin-2' } });
    expect((await screen.findByRole('button', { name: /Restore…/ })).disabled).toBe(true);
  });

  test('a running restore is polled every 2 s until it finishes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const refreshLock = vi.fn();
    taxonomyService.listRestores
      .mockResolvedValueOnce({ data: [{ restore_id: 'r1', snapshot_id: 's-pub', status: 'restoring', created_by: 'admin-1', progress: 'Loading professions' }] })
      .mockResolvedValue({ data: [{ restore_id: 'r1', snapshot_id: 's-pub', status: 'restored', created_by: 'admin-1' }] });
    taxonomyService.getRestore
      .mockResolvedValueOnce({ data: { restore_id: 'r1', status: 'restoring' } })
      .mockResolvedValue({ data: { restore_id: 'r1', status: 'restored' } });
    renderTab({ refreshLock });
    expect((await screen.findByTestId('restore-running')).textContent).toMatch(/Loading professions/);
    expect((await screen.findByRole('button', { name: /Restore…/ })).disabled).toBe(true);

    await act(async () => vi.advanceTimersByTime(2000));
    await waitFor(() => expect(taxonomyService.getRestore).toHaveBeenCalledTimes(1));
    await act(async () => vi.advanceTimersByTime(2000));
    await waitFor(() => expect(screen.queryByTestId('restore-running')).toBeNull());
    expect(refreshLock).toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(10000));
    expect(taxonomyService.getRestore).toHaveBeenCalledTimes(2);
  });
});
