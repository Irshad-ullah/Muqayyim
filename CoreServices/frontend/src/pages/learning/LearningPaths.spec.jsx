import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Module 6 Part 5: the learning-path pages and the setup dialog.
vi.mock('../../services/learningPathService.js', () => ({
  learningPathService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), setStatus: vi.fn(), remove: vi.fn() },
}));
vi.mock('../../services/aiService.js', () => ({ aiService: { giveConsent: vi.fn() } }));
vi.mock('../../components/Navbar.jsx', () => ({ default: () => <nav data-testid="navbar" /> }));

const { learningPathService } = await import('../../services/learningPathService.js');
const { aiService } = await import('../../services/aiService.js');
const { default: LearningPathsPage } = await import('../LearningPathsPage.jsx');
const { default: LearningPathPage } = await import('./LearningPathPage.jsx');
const { default: GeneratePathDialog } = await import('./GeneratePathDialog.jsx');

const rec = (title, free = true) => ({ platform: 'YouTube', title, instructor: 'Net Ninja', description: 'Course.', free, language: 'English',
  searchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`, searchLabel: 'Find on YouTube',
  label: free ? 'AI recommendation' : 'AI recommendation, check before buying' });
const PATH = {
  id: 'p1', title: 'Frontend Developer', source: 'curated', preferences: { language: 'English', cost: 'include_paid', hoursPerWeek: 6 },
  enrichment: { status: 'enriched' }, more: { count: 2, skills: ['Git', 'Figma'] },
  progress: { total: 2, completed: 0, inProgress: 0, percent: 0 },
  modules: [
    { key: 'javascript', skill: 'JavaScript', order: 1, tier: 'essential', quickWin: false, status: 'not_started', why: 'The language of the web.',
      subtopics: ['Syntax', 'DOM', 'Async'], project: 'A to-do app.', hours: { min: 8, max: 12 }, recommendations: [rec('JS Course'), rec('JS Bootcamp', false)] },
    { key: 'react', skill: 'React', order: 2, tier: 'essential', quickWin: true, hint: { skill: 'Vue.js' }, status: 'not_started',
      why: 'Builds UIs.', subtopics: ['JSX', 'State', 'Hooks'], project: 'A dashboard.', hours: { min: 4, max: 8 }, recommendations: [rec('React Course')] },
  ],
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const renderAt = (path, element, route) => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} />
    <Route path="/learning-paths/:id" element={<div data-testid="opened-path" />} /></Routes></MemoryRouter>,
);

describe('LearningPathsPage', () => {
  test('lists paths with progress and has an empty state', async () => {
    learningPathService.list.mockResolvedValueOnce([{ id: 'p1', title: 'Frontend Developer', source: 'curated',
      progress: { total: 4, completed: 1, percent: 25 } }]);
    renderAt('/learning-paths', <LearningPathsPage />, '/learning-paths');
    const row = await screen.findByTestId('path-row');
    expect(row.textContent).toContain('Frontend Developer');
    expect(row.textContent).toContain('1 of 4 modules completed (25%)');
    expect(row.textContent).toContain('Curated');
    expect(screen.getByText('Back to dashboard')).toBeTruthy();
    cleanup();
    learningPathService.list.mockResolvedValueOnce([]);
    renderAt('/learning-paths', <LearningPathsPage />, '/learning-paths');
    expect(await screen.findByTestId('no-paths')).toBeTruthy();
  });
});

describe('LearningPathPage', () => {
  test('modules in order with status, the timeline, details with labelled AI recommendations and search links', async () => {
    learningPathService.get.mockResolvedValue(PATH);
    renderAt('/learning-paths/p1', <LearningPathPage />, '/learning-paths/:id');
    const rows = await screen.findAllByTestId('module-row');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('1. JavaScript'), expect.stringContaining('2. React')]);
    expect(rows[1].textContent).toContain('quick win');
    expect(screen.getByTestId('path-progress').textContent).toContain('0 of 2 modules completed (0%) · about 3 weeks at 6 h per week');
    expect(screen.getByTestId('timeline').textContent).toContain('Week 1: JavaScript (6 h)');
    expect(screen.getByTestId('more-skills').textContent).toBe('2 more skills — create the next path after this one');
    const details = screen.getByTestId('module-details');
    expect(details.textContent).toContain('8–12 h (estimated)');
    const recs = within(details).getAllByTestId('recommendation');
    expect(within(recs[0]).getByTestId('rec-label').textContent).toContain('AI recommendation · free');
    expect(within(recs[1]).getByTestId('rec-label').textContent).toContain('AI recommendation, check before buying · paid');
    const link = within(recs[0]).getByRole('link', { name: /Find on YouTube/ });
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/results?search_query=JS%20Course');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  test('marking a module completed updates it and says the skill is now in the profile (not verified)', async () => {
    const user = userEvent.setup();
    learningPathService.get.mockResolvedValue(PATH);
    const done = { ...PATH, progress: { total: 2, completed: 1, percent: 50 },
      modules: [{ ...PATH.modules[0], status: 'completed' }, PATH.modules[1]] };
    learningPathService.setStatus.mockResolvedValue(done);
    renderAt('/learning-paths/p1', <LearningPathPage />, '/learning-paths/:id');
    await user.click(await screen.findByRole('button', { name: /Mark completed/ }));
    expect(learningPathService.setStatus).toHaveBeenCalledWith('p1', 'javascript', 'completed');
    await waitFor(() => expect(screen.getAllByTestId('module-status')[0].textContent).toBe('Completed'));
    expect(screen.getByTestId('module-details').textContent).toContain('completed in your learning path (not verified)');
    expect(screen.getByTestId('path-progress').textContent).toContain('1 of 2 modules completed (50%)');
  });

  test('a path without enrichment says so and still shows its modules', async () => {
    learningPathService.get.mockResolvedValue({ ...PATH, enrichment: { status: 'unavailable' },
      modules: PATH.modules.map(({ why, subtopics, project, hours, recommendations, ...m }) => m) });
    renderAt('/learning-paths/p1', <LearningPathPage />, '/learning-paths/:id');
    expect(await screen.findByTestId('no-enrichment')).toBeTruthy();
    expect(screen.getAllByTestId('module-row')).toHaveLength(2);
    expect(screen.queryByTestId('timeline')).toBeNull();
  });
});

describe('GeneratePathDialog', () => {
  const member = { required: [
    { key: 'react', name: 'React / Angular', status: 'missing', group: { phrase: 'React / Angular', alternatives: ['React', 'Angular'] } },
    { key: 'git', name: 'Git', status: 'matched' },
  ] };

  test('chooses the alternative and preferences, and asks for consent first when needed', async () => {
    const user = userEvent.setup();
    learningPathService.create
      .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'AI_CONSENT_REQUIRED',
        data: { text: 'Your CV/profile text, and your skills and learning preferences, to build learning paths, are sent to Google Gemini…', currentVersion: '2026-10-18' } }))
      .mockResolvedValueOnce({ id: 'new1' });
    aiService.giveConsent.mockResolvedValue({ granted: true });
    renderAt('/careers', <GeneratePathDialog professionId="curated:frontend-developer" title="Frontend Developer" member={member} onClose={vi.fn()} />, '/careers');
    await user.selectOptions(screen.getByLabelText('React / Angular'), 'angular');
    await user.selectOptions(screen.getByLabelText('Language'), 'Urdu-Hindi');
    await user.selectOptions(screen.getByLabelText('Resources'), 'include_paid');
    await user.click(screen.getByRole('button', { name: 'Create learning path' }));
    expect(await screen.findByTestId('ai-consent-text')).toBeTruthy();
    expect(screen.getByTestId('ai-consent-text').textContent).toContain('learning preferences, to build learning paths');
    await user.click(screen.getByRole('button', { name: /Agree/ }));
    await waitFor(() => expect(screen.getByTestId('opened-path')).toBeTruthy());
    expect(aiService.giveConsent).toHaveBeenCalledWith('2026-10-18');
    expect(learningPathService.create).toHaveBeenLastCalledWith({ professionId: 'curated:frontend-developer', choices: { react: 'angular' },
      preferences: { language: 'Urdu-Hindi', cost: 'include_paid', hoursPerWeek: 5 } });
  });

  test('shows the reason when a path cannot be created', async () => {
    const user = userEvent.setup();
    learningPathService.create.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'PATH_LIMIT' }));
    renderAt('/careers', <GeneratePathDialog professionId="onet:15-1252.00" title="Software Developers" member={{ required: [] }} onClose={vi.fn()} />, '/careers');
    await user.click(screen.getByRole('button', { name: 'Create learning path' }));
    expect((await screen.findByRole('alert')).textContent).toContain('You have 5 learning paths');
  });
});
