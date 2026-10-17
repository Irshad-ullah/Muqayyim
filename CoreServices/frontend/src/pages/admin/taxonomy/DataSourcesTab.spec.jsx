import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/taxonomyService.js', () => ({
  taxonomyService: { getSources: vi.fn(), upload: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const { taxonomyService } = await import('../../../services/taxonomyService.js');
const { default: DataSourcesTab } = await import('./DataSourcesTab.jsx');

const ONET_ATTRIBUTION =
  'O*NET 31.0 Database, U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), used under CC BY 4.0, modified';
const SOURCES = {
  onet: { versions: ['31.0'], professions: 30, active: 29, last_updated: '2026-10-15T10:00:00Z', last_published_job: null, attribution: ONET_ATTRIBUTION },
  esco: {
    versions: ['v1.2.1'], professions: 113, active: 113, esco_skills: 13939, last_updated: '2026-10-15T10:00:00Z',
    last_published_job: { job_id: 'j0', dataset_version: 'ESCO v1.2.1', created_by: 'admin-1', updated_at: '2026-10-15T11:00:00Z' },
    attribution: 'ESCO v1.2.1 © European Union',
  },
  manual: { professions: 0, active: 0 },
};
// A small File that reports `size` bytes (no need to allocate 100 MB in a test).
const csv = (name, size = 1000) => Object.defineProperty(new File(['x'], name, { type: 'text/csv' }), 'size', { value: size });
const httpError = (status, data = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers: {} } });

beforeEach(() => {
  vi.clearAllMocks();
  taxonomyService.getSources.mockResolvedValue({ data: SOURCES });
});
afterEach(cleanup);

const RETIRED = {
  ...SOURCES,
  esco: { ...SOURCES.esco, active: 0, retired: true, upload_enabled: false,
    retired_message: 'ESCO is retired: its roles were replaced by the curated modern roles v1 (Module 5.2). To re-enable ESCO, restore the snapshot taken before the retirement (History tab → Restore).',
    retirement: { job_id: 'jr', snapshot_id: '20261017T120000-abcd1234' } },
  curated: { versions: ['curated v1.0.0'], professions: 19, active: 19, last_updated: '2026-10-17T12:00:00Z', last_published_job: null,
    attribution: 'Muqayyim curated modern IT roles', upload_enabled: true },
};

describe('DataSourcesTab — Module 5.2 (curated roles, ESCO retired)', () => {
  test('ESCO shows as retired with the explanation and its upload is disabled; the curated source is listed', async () => {
    taxonomyService.getSources.mockResolvedValue({ data: RETIRED });
    render(<DataSourcesTab lock={null} onUploaded={vi.fn()} />);
    const esco = await screen.findByTestId('source-esco');
    expect(within(esco).getByTestId('retired-badge').textContent).toBe('Retired');
    expect(within(esco).getByTestId('retired-note').textContent).toContain('restore the snapshot taken before the retirement');
    expect(within(esco).getByTestId('retired-note').textContent).toContain('20261017T120000-abcd1234');
    expect(within(screen.getByTestId('source-curated')).getByText('19 (19 active)')).toBeTruthy();
    const option = screen.getByRole('option', { name: 'ESCO (retired)' });
    expect(option.disabled).toBe(true);
  });

  test('the curated upload takes one .json file with the dataset version', async () => {
    const user = userEvent.setup({ applyAccept: false }); // let the wrong file through to see the check
    taxonomyService.getSources.mockResolvedValue({ data: RETIRED });
    render(<DataSourcesTab lock={null} onUploaded={vi.fn()} />);
    await screen.findByTestId('source-curated');
    await user.selectOptions(screen.getByLabelText('Source'), 'curated');
    expect(screen.getByTestId('source-hint').textContent).toContain('modern_roles_v1.json');
    expect(screen.getByLabelText('Dataset version').value).toBe('1.0.0');
    expect(screen.getByLabelText('Files').getAttribute('accept')).toBe('.json');
    await user.upload(screen.getByLabelText('Files'), csv('occupation_data.csv'));
    expect(screen.getByText('Choose the one curated dataset file (.json).')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload and validate' }).disabled).toBe(true);
  });
});

describe('DataSourcesTab', () => {
  test('loading, then what is loaded per source, with the attribution', async () => {
    render(<DataSourcesTab lock={null} onUploaded={vi.fn()} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    const esco = await screen.findByTestId('source-esco');
    expect(within(esco).getByText('113 (113 active)')).toBeTruthy();
    expect(within(esco).getByText('13939')).toBeTruthy();
    expect(within(esco).getByText(/ESCO v1.2.1 by admin-1/)).toBeTruthy();
    expect(within(screen.getByTestId('source-onet')).getByText('none through the admin panel')).toBeTruthy();
    const attribution = screen.getByTestId('attribution').textContent;
    expect(attribution).toContain(ONET_ATTRIBUTION);
    expect(attribution).toContain('ESCO v1.2.1 © European Union');
  });

  test('error: sources cannot load', async () => {
    taxonomyService.getSources.mockRejectedValue(httpError(504, { code: 'TAXONOMY_TIMEOUT' }));
    render(<DataSourcesTab lock={null} />);
    expect(await screen.findByText(/took too long/)).toBeTruthy();
  });

  test('the hint names exactly the files each source needs', async () => {
    const user = userEvent.setup();
    render(<DataSourcesTab lock={null} />);
    await screen.findByTestId('source-onet');
    const hint = screen.getByTestId('source-hint');
    expect(hint.textContent).toContain('onetcenter.org/database.html: occupation_data.csv, job_titles.csv, software_skills.csv');
    await user.selectOptions(screen.getByLabelText('Source'), 'esco');
    expect(hint.textContent).toMatch(/classification CSV ZIP/);
    expect(hint.textContent).toContain('occupations_en.csv, skills_en.csv, occupationSkillRelations_en.csv');
    expect(screen.getByLabelText('Dataset version').value).toBe('ESCO v1.2.1');
  });

  test('upload: progress, then the new job is handed to Preview & publish', async () => {
    const user = userEvent.setup();
    const onUploaded = vi.fn();
    let finish;
    taxonomyService.upload.mockImplementation((_payload, onProgress) => {
      onProgress(0.5);
      return new Promise((resolve) => {
        finish = () => resolve({ data: { job_id: 'j-new', status: 'uploaded' } });
      });
    });
    render(<DataSourcesTab lock={null} onUploaded={onUploaded} />);
    await screen.findByTestId('source-onet');
    const files = [csv('occupation_data.csv'), csv('job_titles.csv'), csv('software_skills.csv')];
    await user.upload(screen.getByLabelText('Files'), files);
    await user.click(screen.getByRole('button', { name: 'Upload and validate' }));
    expect(await screen.findByRole('progressbar')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Uploading… 50%/ }).disabled).toBe(true);
    const [payload] = taxonomyService.upload.mock.calls[0];
    expect(payload.source).toBe('onet');
    expect(payload.datasetVersion).toBe('O*NET 31.0');
    expect(payload.files.map((f) => f.name)).toEqual(['occupation_data.csv', 'job_titles.csv', 'software_skills.csv']);
    finish();
    await vi.waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ job_id: 'j-new', status: 'uploaded' }));
  });

  test('too large: refused before sending, and a server 413 is explained', async () => {
    const user = userEvent.setup();
    render(<DataSourcesTab lock={null} />);
    await screen.findByTestId('source-onet');
    await user.upload(screen.getByLabelText('Files'), [csv('big.csv', 101 * 1024 * 1024)]);
    expect(screen.getByText(/the limit is 100 MB/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload and validate' }).disabled).toBe(true);

    taxonomyService.upload.mockRejectedValue(httpError(413, { code: 'PAYLOAD_TOO_LARGE' }));
    await user.upload(screen.getByLabelText('Files'), [csv('occupation_data.csv')]);
    await user.click(screen.getByRole('button', { name: 'Upload and validate' }));
    expect(await screen.findByText('Upload too large')).toBeTruthy();
  });

  test('a rejected upload (422) lists the reasons', async () => {
    const user = userEvent.setup();
    taxonomyService.upload.mockRejectedValue(httpError(422, { code: 'UPLOAD_REJECTED', message: 'The ZIP is not safe to open', errors: ['../evil.csv: path leaves the folder'] }));
    render(<DataSourcesTab lock={null} />);
    await screen.findByTestId('source-onet');
    await user.upload(screen.getByLabelText('Files'), [csv('esco.zip')]);
    await user.click(screen.getByRole('button', { name: 'Upload and validate' }));
    expect(await screen.findByText('The ZIP is not safe to open')).toBeTruthy();
    expect(screen.getByText('../evil.csv: path leaves the folder')).toBeTruthy();
  });

  test('upload is disabled while the taxonomy lock is held', async () => {
    const user = userEvent.setup();
    render(<DataSourcesTab lock={{ owner: 'job:j2', actor: 'admin-2' }} />);
    await screen.findByTestId('source-onet');
    await user.upload(screen.getByLabelText('Files'), [csv('occupation_data.csv')]);
    expect(screen.getByRole('button', { name: 'Upload and validate' }).disabled).toBe(true);
  });
});
