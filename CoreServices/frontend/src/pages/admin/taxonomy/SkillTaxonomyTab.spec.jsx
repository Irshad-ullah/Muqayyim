import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/taxonomyService.js', () => ({
  taxonomyService: { listSkills: vi.fn(), validateSkill: vi.fn(), createSkill: vi.fn(), updateSkill: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const { taxonomyService } = await import('../../../services/taxonomyService.js');
const { default: SkillTaxonomyTab, parseAliases } = await import('./SkillTaxonomyTab.jsx');
const toast = (await import('react-hot-toast')).default;

const REACT = { name: 'React', description: 'A JavaScript library for building user interfaces.', aliases: ['reactjs'], category: 'Frontend', seed: true };
const KAFKA = { name: 'Apache Kafka', description: 'A distributed event streaming platform.', aliases: ['kafka'], category: 'Data', seed: false };
const list = (data = [REACT, KAFKA]) => ({ data, categories: ['Data', 'Frontend'], pagination: { page: 1, pages: 1, total: data.length, limit: 50 } });
const httpError = (status, data = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers: {} } });

beforeEach(() => {
  vi.clearAllMocks();
  taxonomyService.listSkills.mockResolvedValue(list());
});
afterEach(cleanup);

const open = async (user, name) => {
  const row = (await screen.findAllByTestId('skill-row')).find((r) => r.textContent.startsWith(name));
  await user.click(row);
  return screen.findByTestId('skill-editor');
};

describe('SkillTaxonomyTab', () => {
  test('loading, empty and error states', async () => {
    render(<SkillTaxonomyTab lock={null} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(await screen.findAllByTestId('skill-row')).toHaveLength(2);
    cleanup();
    taxonomyService.listSkills.mockResolvedValueOnce(list([]));
    render(<SkillTaxonomyTab lock={null} />);
    expect(await screen.findByText('No skills match.')).toBeTruthy();
    cleanup();
    taxonomyService.listSkills.mockRejectedValueOnce(httpError(504, { code: 'TAXONOMY_TIMEOUT' }));
    render(<SkillTaxonomyTab lock={null} />);
    expect(await screen.findByText(/took too long/)).toBeTruthy();
  });

  test('a seed skill’s description is read-only; aliases stay editable', async () => {
    const user = userEvent.setup();
    render(<SkillTaxonomyTab lock={null} />);
    const editor = await open(user, 'React');
    expect(within(editor).getByLabelText('Description').disabled).toBe(true);
    expect(within(editor).getByTestId('seed-note').textContent).toMatch(/read-only/);
    expect(within(editor).getByLabelText(/Aliases/).disabled).toBe(false);
  });

  test('edit a non-seed description: Check shows the errors, Save reports the re-embedded skill', async () => {
    const user = userEvent.setup();
    taxonomyService.validateSkill.mockResolvedValueOnce({ data: { valid: false, errors: ['Description too short (min 40 characters)'] } });
    taxonomyService.updateSkill.mockResolvedValue({ data: { result: { skill: { ...KAFKA, description: 'x' }, re_embedded: ['Apache Kafka'] }, snapshot_id: 'e1' } });
    render(<SkillTaxonomyTab lock={null} />);
    const editor = await open(user, 'Apache Kafka');
    const description = within(editor).getByLabelText('Description');
    await user.clear(description);
    await user.type(description, 'Too short');
    await user.click(within(editor).getByRole('button', { name: 'Check' }));
    expect(taxonomyService.validateSkill).toHaveBeenCalledWith({ name: 'Apache Kafka', description: 'Too short' }, false);
    expect((await within(editor).findByTestId('skill-check')).textContent).toMatch(/too short/);

    await user.clear(description);
    await user.type(description, 'An open-source platform for streaming events between services in real time.');
    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    expect(taxonomyService.updateSkill).toHaveBeenCalledWith('Apache Kafka', {
      description: 'An open-source platform for streaming events between services in real time.',
    });
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved — re-embedded Apache Kafka'));
  });

  test('a refused save (409 seed / 422 invalid) shows the reason', async () => {
    const user = userEvent.setup();
    taxonomyService.updateSkill.mockRejectedValueOnce(
      httpError(422, { code: 'SKILL_INVALID', message: 'The change does not pass the description checks', errors: ['Alias "kafka" is already used by Kafka Streams'] }),
    );
    render(<SkillTaxonomyTab lock={null} />);
    const editor = await open(user, 'Apache Kafka');
    await user.type(within(editor).getByLabelText(/Aliases/), ', kstreams');
    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    expect(await within(editor).findByText('Alias "kafka" is already used by Kafka Streams')).toBeTruthy();
    expect(taxonomyService.updateSkill).toHaveBeenCalledWith('Apache Kafka', { aliases: ['kafka', 'kstreams'] });
  });

  test('create a new skill', async () => {
    const user = userEvent.setup();
    taxonomyService.createSkill.mockResolvedValue({ data: { result: { skill: { name: 'Temporal' }, re_embedded: ['Temporal'] } } });
    render(<SkillTaxonomyTab lock={null} />);
    await screen.findAllByTestId('skill-row');
    await user.click(screen.getByRole('button', { name: /New skill/ }));
    const editor = await screen.findByTestId('skill-editor');
    await user.type(within(editor).getByLabelText('Name'), 'Temporal');
    await user.type(within(editor).getByLabelText('Description'), 'A workflow engine for durable, long-running application processes.');
    await user.selectOptions(within(editor).getByLabelText('Category'), 'Data');
    await user.click(within(editor).getByRole('button', { name: 'Create skill' }));
    expect(taxonomyService.createSkill).toHaveBeenCalledWith({
      name: 'Temporal', description: 'A workflow engine for durable, long-running application processes.', aliases: [], category: 'Data',
    });
  });

  test('editing is disabled while the lock is held', async () => {
    const user = userEvent.setup();
    render(<SkillTaxonomyTab lock={{ owner: 'job:j1', actor: 'admin-2' }} />);
    expect((await screen.findByRole('button', { name: /New skill/ })).disabled).toBe(true);
    const editor = await open(user, 'Apache Kafka');
    expect(within(editor).getByLabelText('Description').disabled).toBe(true);
    expect(within(editor).getByRole('button', { name: 'Save' }).disabled).toBe(true);
  });

  test('aliases are split on commas and trimmed', () => {
    expect(parseAliases(' kafka ,  kstreams,, ')).toEqual(['kafka', 'kstreams']);
    expect(parseAliases('')).toEqual([]);
  });
});
