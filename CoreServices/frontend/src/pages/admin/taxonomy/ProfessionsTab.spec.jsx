import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/taxonomyService.js', () => ({
  taxonomyService: { listProfessions: vi.fn(), editProfession: vi.fn(), resetProfession: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const { taxonomyService } = await import('../../../services/taxonomyService.js');
const { default: ProfessionsTab } = await import('./ProfessionsTab.jsx');

const CATEGORIES = ['Development', 'Data & AI', 'Other'];
const DEV = {
  profession_id: 'onet:15-1252.00', source: 'onet', source_code: '15-1252.00', title: 'Coders', description: 'Write software.',
  category: 'Development', active: true, skills: [{ name: 'Python' }], title_set_by_admin: true,
  dataset_values: { title: 'Software Developers' }, updated_at: '2026-10-16T10:00:00Z',
};
const MANUAL = { profession_id: 'manual:1', source: 'manual', title: 'Prompt engineer', category: 'Data & AI', active: true, skills: [] };
const list = (data = [DEV, MANUAL]) => ({ data, categories: CATEGORIES, pagination: { page: 1, pages: 1, total: data.length, limit: 20 } });
const httpError = (status, data = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers: {} } });

beforeEach(() => {
  vi.clearAllMocks();
  taxonomyService.listProfessions.mockResolvedValue(list());
});
afterEach(cleanup);

const openEditor = async (user, title) => {
  await user.click(await screen.findByRole('button', { name: `Edit ${title}` }));
  return screen.findByTestId('profession-edit');
};

const ESCO_DEV = {
  profession_id: 'esco:dev', source: 'esco', source_code: '2512.4', title: 'mobile application developer', category: 'Development',
  active: true, updated_at: '2026-10-17T10:00:00Z',
  skills: [
    { name: 'computer programming', key: 'computer programming', type: 'essential', source: 'role_map', phrase: 'computer programming',
      label: 'Kotlin / Swift / Java / … (computer programming)', alternatives: [{ name: 'Kotlin', key: 'kotlin' }, { name: 'Swift', key: 'swift' }, { name: 'Java', key: 'java' }, { name: 'Dart', key: 'dart' }] },
    { name: 'think analytically', key: 'think analytically', type: 'essential' },
  ],
};

describe('ProfessionsTab', () => {
  test('Module 5.1: an ESCO role shows its adjusted requirements with the original phrase', async () => {
    const user = userEvent.setup();
    taxonomyService.listProfessions.mockResolvedValue(list([ESCO_DEV]));
    render(<ProfessionsTab lock={null} />);
    const editor = await openEditor(user, 'mobile application developer');
    const box = within(editor).getByTestId('requirements');
    expect(box.textContent).toContain('Skills (2, 1 adjusted by the ESCO role map)');
    const items = within(box).getAllByTestId('requirement');
    expect(items.map((i) => i.dataset.adjusted)).toEqual(['yes', 'no']);
    expect(items[0].textContent).toContain('Kotlin / Swift / Java / … (computer programming)');
    expect(items[0].textContent).toContain('any one of: Kotlin, Swift, Java, Dart');
    expect(items[0].textContent).toContain('original ESCO phrase: “computer programming”');
    expect(items[1].textContent).toContain('think analytically');
  });

  test('loading, then the list with override markers', async () => {
    render(<ProfessionsTab lock={null} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    const rows = await screen.findAllByTestId('profession-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(/override: title/)).toBeTruthy();
  });

  test('empty and error states', async () => {
    taxonomyService.listProfessions.mockResolvedValueOnce(list([]));
    render(<ProfessionsTab lock={null} />);
    expect(await screen.findByText(/No professions match/)).toBeTruthy();
    cleanup();
    taxonomyService.listProfessions.mockRejectedValueOnce(httpError(503, { code: 'TAXONOMY_UNAVAILABLE' }));
    render(<ProfessionsTab lock={null} />);
    expect(await screen.findByText(/AI service is not reachable/)).toBeTruthy();
  });

  test('search is sent to the API', async () => {
    const user = userEvent.setup();
    render(<ProfessionsTab lock={null} />);
    await screen.findAllByTestId('profession-row');
    await user.type(screen.getByLabelText('Search professions'), 'data');
    await waitFor(() => expect(taxonomyService.listProfessions).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: 'data' }));
  });

  test('save sends only the changed fields', async () => {
    const user = userEvent.setup();
    taxonomyService.editProfession.mockResolvedValue({ data: { result: { ...DEV, category: 'Data & AI', category_set_by_admin: true }, snapshot_id: 'e1' } });
    render(<ProfessionsTab lock={null} />);
    const panel = await openEditor(user, 'Coders');
    expect(within(panel).getByRole('button', { name: 'Save' }).disabled).toBe(true); // nothing changed yet
    await user.selectOptions(within(panel).getByLabelText(/Category/), 'Data & AI');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(taxonomyService.editProfession).toHaveBeenCalledWith('onet:15-1252.00', { category: 'Data & AI' });
  });

  test('an override can be reset to the dataset value', async () => {
    const user = userEvent.setup();
    taxonomyService.resetProfession.mockResolvedValue({ data: { result: { ...DEV, title: 'Software Developers', title_set_by_admin: false }, snapshot_id: 'e2' } });
    render(<ProfessionsTab lock={null} />);
    const panel = await openEditor(user, 'Coders');
    expect(within(panel).getByText('Admin override')).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'reset to dataset value' }));
    expect(taxonomyService.resetProfession).toHaveBeenCalledWith('onet:15-1252.00', ['title']);
    await waitFor(() => expect(within(screen.getByTestId('profession-edit')).queryByText('Admin override')).toBeNull());
  });

  test('manual professions have no reset', async () => {
    const user = userEvent.setup();
    render(<ProfessionsTab lock={null} />);
    const panel = await openEditor(user, 'Prompt engineer');
    expect(within(panel).queryByText(/reset/i)).toBeNull();
  });

  test('a busy taxonomy (409) is explained', async () => {
    const user = userEvent.setup();
    taxonomyService.editProfession.mockRejectedValue(httpError(409, { code: 'TAXONOMY_BUSY', lock: { owner: 'restore:r1', actor: 'admin-2' } }));
    render(<ProfessionsTab lock={null} />);
    const panel = await openEditor(user, 'Coders');
    await user.clear(within(panel).getByLabelText(/Title/));
    await user.type(within(panel).getByLabelText(/Title/), 'Programmers');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText(/Restoring a snapshot \(by admin-2\)/)).toBeTruthy();
  });

  test('every field and button is disabled while the lock is held', async () => {
    const user = userEvent.setup();
    render(<ProfessionsTab lock={{ owner: 'job:j1', actor: 'admin-2' }} />);
    const panel = await openEditor(user, 'Coders');
    expect(within(panel).getByLabelText(/Title/).disabled).toBe(true);
    expect(within(panel).getByRole('button', { name: 'Save' }).disabled).toBe(true);
    expect(within(panel).getByRole('button', { name: 'reset to dataset value' }).disabled).toBe(true);
    expect(within(panel).getByRole('button', { name: /Reset all overrides/ }).disabled).toBe(true);
  });
});
