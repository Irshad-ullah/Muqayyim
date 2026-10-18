import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../components/Navbar.jsx', () => ({ default: () => null }));
vi.mock('../services/careerMatchService.js', () => ({
  careerMatchService: { getMatches: vi.fn(), getMatch: vi.fn() },
}));

const { careerMatchService } = await import('../services/careerMatchService.js');
const { default: CareerMatchesPage } = await import('./CareerMatchesPage.jsx');

const ONET = 'O*NET 31.0 Database, U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), used under CC BY 4.0, modified';
const ESCO = 'ESCO v1.2.1 © European Union';

const summary = (id, title, score, extra = {}) => ({
  profession_id: id, title, score, source: 'onet', category: 'Development', categories: ['Development'],
  matched: 3, related: 2, missing: 5, required_count: 10, gap_count: 5,
  sources: [{ profession_id: id, source: 'onet', title, score, category: 'Development', attribution: ONET }], ...extra,
});
const RESULTS = [
  summary('onet:15-1252.00', 'Software Developers', 55, {
    sources: [
      { profession_id: 'onet:15-1252.00', source: 'onet', title: 'Software Developers', score: 55, category: 'Development', attribution: ONET },
      { profession_id: 'esco:dev', source: 'esco', title: 'software developer', score: 31, category: 'Development', attribution: ESCO },
    ],
  }),
  summary('onet:15-1254.00', 'Web Developers', 53),
  summary('esco:ui', 'user interface designer', 25, { source: 'esco', category: 'Design', categories: ['Design'],
    sources: [{ profession_id: 'esco:ui', source: 'esco', title: 'user interface designer', score: 25, category: 'Design', attribution: ESCO }] }),
  summary('onet:15-1212.00', 'Information Security Analysts', 12, { category: 'Security', categories: ['Security'] }),
];
const ready = (overrides = {}) => ({ state: 'ready', results: RESULTS, best_score: 55, low_match: false, skill_count: 8, ...overrides });

const member = (id, source, title, score, attribution) => ({
  profession_id: id, source, title, score, matched: 1, related: 1, missing: 1, attribution,
  required: [
    { name: 'React', key: 'react', status: 'matched', credit: 1, via: { name: 'React', source: 'cv' } },
    { name: 'Vue.js', key: 'vue.js', status: 'related', credit: 0.5, via: { name: 'React', source: 'cv', similarity: 0.9, kind: 'described' } },
    { name: 'Kubernetes', key: 'kubernetes', status: 'missing', credit: 0 },
  ],
  optional: [{ name: 'Git', key: 'git', status: 'matched', credit: 1, via: { name: 'Git', source: 'github' } }],
  gaps: ['Kubernetes'],
  explanation: [`${title} needs 3 key skills; your match is ${score}%: 1 matched, 1 related and 1 missing.`, 'To close the gap, learn Kubernetes.'],
});
const detailFor = (id) => {
  const result = RESULTS.find((r) => r.profession_id === id);
  const members = result.sources.map((s) => member(s.profession_id, s.source, s.title, s.score, s.attribution));
  return { ...result, rank: RESULTS.indexOf(result) + 1, of: RESULTS.length, members };
};
const httpError = (code, status = 503) => Object.assign(new Error('x'), { code, status });

const renderPage = () => render(<MemoryRouter><CareerMatchesPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  careerMatchService.getMatches.mockResolvedValue(ready());
  careerMatchService.getMatch.mockImplementation(async (id) => detailFor(id));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Career Matching — states', () => {
  test('loading, then the ranked list with the best career selected', async () => {
    renderPage();
    expect(screen.getByTestId('state-loading')).toBeTruthy();
    const rows = await screen.findAllByTestId('career-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Software Developers'), expect.stringContaining('Web Developers'),
      expect.stringContaining('user interface designer'), expect.stringContaining('Information Security Analysts'),
    ]);
    expect(rows[0].getAttribute('aria-current')).toBe('true');
    expect(within(rows[0]).getByText('55%')).toBeTruthy();
    expect(within(rows[0]).getByText('O*NET')).toBeTruthy();
    expect(within(rows[0]).getByText('ESCO')).toBeTruthy();
    expect(await screen.findByTestId('career-details')).toBeTruthy();
    expect(screen.getByTestId('dashboard-link').getAttribute('href')).toBe('/dashboard');
  });

  test('no skills: links to the Profile Builder and CV upload', async () => {
    careerMatchService.getMatches.mockResolvedValue({ state: 'no_skills', results: [] });
    renderPage();
    const box = await screen.findByTestId('state-no-skills');
    expect(within(box).getByRole('link', { name: /Profile Builder/ }).getAttribute('href')).toBe('/profile-builder');
    expect(within(box).getByRole('link', { name: /Upload your CV/ }).getAttribute('href')).toBe('/cv-parsing');
  });

  test.each([
    ['MODEL_LOADING', 'state-starting', /skill model is loading/],
    ['INDEX_BUILDING', 'state-starting', /career database is being prepared/],
    ['NO_PROFESSIONS', 'state-unavailable', /No careers available yet/],
    ['MATCHING_UNAVAILABLE', 'state-unavailable', /not reachable right now/],
  ])('%s (503) has its own message and a retry', async (code, testId, text) => {
    const user = userEvent.setup();
    careerMatchService.getMatches.mockRejectedValueOnce(httpError(code));
    renderPage();
    const box = await screen.findByTestId(testId);
    expect(box.textContent).toMatch(text);
    expect(screen.getByTestId('dashboard-link')).toBeTruthy(); // always visible (FR7.9)
    await user.click(within(box).getByRole('button', { name: /Try again/ }));
    expect(await screen.findAllByTestId('career-row')).toHaveLength(4);
  });

  test('504 and a generic error show safe messages', async () => {
    careerMatchService.getMatches.mockRejectedValueOnce(httpError('MATCHING_TIMEOUT', 504));
    renderPage();
    expect((await screen.findByTestId('state-timeout')).textContent).toMatch(/did not respond in time/);
    cleanup();
    careerMatchService.getMatches.mockRejectedValueOnce(Object.assign(new Error('TypeError: cannot read x'), { status: 500 }));
    renderPage();
    const box = await screen.findByTestId('state-error');
    expect(box.textContent).toMatch(/could not load your career matches/);
    expect(box.textContent).not.toMatch(/TypeError/);
  });

  test('EMBEDDINGS_PENDING polls every 5 s while visible and stops once ready', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    careerMatchService.getMatches
      .mockRejectedValueOnce(httpError('EMBEDDINGS_PENDING'))
      .mockRejectedValueOnce(httpError('EMBEDDINGS_PENDING'))
      .mockResolvedValue(ready());
    renderPage();
    expect((await screen.findByTestId('state-pending')).textContent).toMatch(/being analysed/);
    await act(async () => vi.advanceTimersByTime(5000));
    await waitFor(() => expect(careerMatchService.getMatches).toHaveBeenCalledTimes(2));
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => vi.advanceTimersByTime(20000));
    expect(careerMatchService.getMatches).toHaveBeenCalledTimes(2); // not while hidden
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(await screen.findAllByTestId('career-row')).toHaveLength(4);
    await act(async () => vi.advanceTimersByTime(20000));
    expect(careerMatchService.getMatches).toHaveBeenCalledTimes(3); // stopped once ready
    hidden.mockRestore();
  });

  test('the low-match note shows when the best result is under 20%, with at least 3 results', async () => {
    const low = RESULTS.map((x, i) => ({ ...x, score: [14, 12, 9, 3][i] }));
    careerMatchService.getMatches.mockResolvedValue(ready({ results: low, best_score: 14, low_match: true }));
    renderPage();
    expect((await screen.findByTestId('low-match')).textContent).toMatch(/best match 14%/);
    expect((await screen.findAllByTestId('career-row')).length).toBeGreaterThanOrEqual(3);
  });

  test('no low-match note for a normal result', async () => {
    renderPage();
    await screen.findAllByTestId('career-row');
    expect(screen.queryByTestId('low-match')).toBeNull();
  });
});

describe('Career Matching — sorting and filtering (instant)', () => {
  test('sort by match % lowest first, then by title', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByTestId('career-row');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'score_asc');
    expect(screen.getAllByTestId('career-row')[0].textContent).toContain('Information Security Analysts');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'title');
    expect(screen.getAllByTestId('career-row')[0].textContent).toContain('Information Security Analysts');
    expect(screen.getAllByTestId('career-row')[3].textContent).toContain('Web Developers');
    expect(careerMatchService.getMatches).toHaveBeenCalledTimes(1); // no reload: done in the browser
  });

  test('filter by category and source; fewer than 3 are topped up with the closest others', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByTestId('career-row');
    await user.selectOptions(screen.getByLabelText('Category'), 'Design');
    const list = screen.getByTestId('career-list');
    expect(within(list).getAllByTestId('career-row').map((r) => r.textContent)).toEqual([expect.stringContaining('user interface designer')]);
    expect(screen.getByTestId('extra-note').textContent).toMatch(/Only 1 match these filters/);
    expect(within(screen.getByTestId('extra-list')).getAllByTestId('career-row')).toHaveLength(2);

    await user.selectOptions(screen.getByLabelText('Category'), '');
    await user.selectOptions(screen.getByLabelText('Source'), 'esco');
    // the merged Software Developers (O*NET + ESCO) and the ESCO designer
    expect(within(screen.getByTestId('career-list')).getAllByTestId('career-row')).toHaveLength(2);
  });

  test('minimum match %', async () => {
    renderPage();
    await screen.findAllByTestId('career-row');
    const slider = screen.getByLabelText(/Minimum match/);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '50');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(within(screen.getByTestId('career-list')).getAllByTestId('career-row')).toHaveLength(2);
    expect(screen.getByText('Minimum match: 50%')).toBeTruthy();
  });

  test('keyboard: arrow keys move through the list and select', async () => {
    const user = userEvent.setup();
    renderPage();
    const rows = await screen.findAllByTestId('career-row');
    rows[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getAllByTestId('career-row')[1]);
    expect(screen.getAllByTestId('career-row')[1].getAttribute('aria-current')).toBe('true');
    await user.keyboard('{End}');
    expect(screen.getAllByTestId('career-row')[3].getAttribute('aria-current')).toBe('true');
    await waitFor(() => expect(careerMatchService.getMatch).toHaveBeenLastCalledWith('onet:15-1212.00'));
  });
});

describe('Career Matching — details', () => {
  test('a merged role shows both source lists with attribution, the merged note and the gap count', async () => {
    renderPage();
    const details = await screen.findByTestId('career-details');
    expect(within(details).getAllByTestId('member')).toHaveLength(2);
    expect(within(details).getByTestId('merged-note').textContent).toMatch(/both O\*NET and ESCO/);
    const attributions = within(details).getAllByTestId('attribution').map((a) => a.textContent);
    expect(attributions).toEqual([ONET, ESCO]);
    expect(within(details).getByText('O*NET list')).toBeTruthy();
    expect(within(details).getByText('ESCO list')).toBeTruthy();
    const learn = within(details).getByRole('button', { name: /Generate learning path \(coming soon\)/ });
    expect(learn.disabled).toBe(true);
    expect(details.textContent).toMatch(/1 skill to learn/);
  });

  test('skill rows say held / related / missing in words, and name the skill behind a related credit', async () => {
    renderPage();
    const details = await screen.findByTestId('career-details');
    const first = within(details).getAllByTestId('member')[0];
    const rows = within(first).getAllByTestId('skill-row');
    expect(rows.map((r) => r.dataset.status)).toEqual(['matched', 'related', 'missing', 'matched']);
    expect(rows[0].textContent).toContain('Held — found in your uploaded CV');
    expect(rows[1].textContent).toContain('Related — via your React (from your uploaded CV), similarity 0.90');
    expect(rows[2].textContent).toContain('Missing');
    expect(within(first).getByTestId('explanation').textContent).toMatch(/To close the gap, learn Kubernetes/);
  });

  test('ESCO requirement groups (Module 5.1) show the named-skill label, the skill that holds them and the alternatives', async () => {
    const group = { phrase: 'use programming languages', phrase_uri: 'u', alternatives: ['Kotlin', 'Swift', 'Java', 'Dart'] };
    careerMatchService.getMatch.mockImplementation(async (id) => {
      const detail = detailFor(id);
      detail.members[0].required = [
        { name: 'Kotlin / Swift / Java / … (use programming languages)', key: 'use programming languages', status: 'matched', credit: 1,
          via: { name: 'Kotlin', source: 'cv', group: true, also: [] }, group },
        { name: 'Selenium / Cypress (execute software tests)', key: 'execute software tests', status: 'missing', credit: 0,
          group: { phrase: 'execute software tests', alternatives: ['Selenium', 'Cypress'] } },
      ];
      return detail;
    });
    renderPage();
    const details = await screen.findByTestId('career-details');
    const rows = within(within(details).getAllByTestId('member')[0]).getAllByTestId('skill-row');
    expect(rows[0].textContent).toContain('Kotlin / Swift / Java / … (use programming languages)');
    expect(rows[0].textContent).toContain('Held via Kotlin, found in your uploaded CV (covers: use programming languages)');
    expect(rows[1].dataset.status).toBe('missing');
    expect(rows[1].textContent).toContain('Missing — any one of: Selenium, Cypress');
  });

  test('Module 5.2 exact mode: a missing skill shows "related to your …" as a suggestion, never as credit', async () => {
    careerMatchService.getMatches.mockResolvedValue(ready({ scoring_mode: 'exact' }));
    careerMatchService.getMatch.mockImplementation(async (id) => {
      const detail = detailFor(id);
      detail.scoring_mode = 'exact';
      detail.members[0] = { ...detail.members[0], matched: 1, related: 0, missing: 2,
        required: [
          { name: 'React', key: 'react', status: 'matched', credit: 1, via: { name: 'React', source: 'cv' } },
          { name: 'Vue.js', key: 'vue.js', status: 'missing', credit: 0, related_hint: { skill: 'React', similarity: 0.9, kind: 'described' } },
          { name: 'Kubernetes', key: 'kubernetes', status: 'missing', credit: 0 },
        ],
        explanation: ['Web developer needs 3 key skills; your match is 33%: 1 matched and 2 missing.'] };
      return detail;
    });
    renderPage();
    const details = await screen.findByTestId('career-details');
    const first = within(details).getAllByTestId('member')[0];
    const rows = within(first).getAllByTestId('skill-row');
    expect(rows.map((r) => r.dataset.status)).toEqual(['matched', 'missing', 'missing', 'matched']);
    expect(rows[1].textContent).toContain('Missing');
    expect(within(rows[1]).getByTestId('related-hint').textContent).toContain('Related to your React');
    expect(within(rows[1]).getByTestId('related-hint').textContent).toContain('not counted in the match');
    expect(within(rows[0]).queryByTestId('related-hint')).toBeNull();
    expect(within(rows[2]).queryByTestId('related-hint')).toBeNull();
    expect(first.textContent).toContain('Required skills (1 held, 2 missing)');
    expect(within(first).getByTestId('explanation').textContent).not.toMatch(/related/i);
    expect(screen.getAllByTestId('career-row')[0].textContent).not.toMatch(/related/); // list rows too
  });

  test('a single-source ESCO role has the ESCO info tooltip and its attribution', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByTestId('career-row'))[2]);
    await waitFor(() => expect(screen.getByTestId('career-details').textContent).toContain('user interface designer'));
    const details = screen.getByTestId('career-details');
    expect(within(details).getAllByTestId('member')).toHaveLength(1);
    const row = screen.getAllByTestId('career-row')[2];
    expect(within(row).getByTestId('esco-hint').getAttribute('title')).toMatch(/ESCO lists broader competences/);
    expect(within(row).queryByRole('button')).toBeNull(); // no button inside the row's button
    expect(within(details).queryByTestId('merged-note')).toBeNull();
    expect(within(details).getByTestId('attribution').textContent).toBe(ESCO);
    const info = within(details).getByRole('button', { name: 'About ESCO scores' });
    await user.hover(info);
    expect(within(details).getByRole('tooltip').textContent).toBe(
      'ESCO lists broader competences, so scores for ESCO roles tend to be lower than for O*NET roles.');
  });

  test('a career that disappeared shows a safe not-found message', async () => {
    careerMatchService.getMatch.mockRejectedValueOnce(httpError('PROFESSION_NOT_FOUND', 404));
    renderPage();
    expect((await screen.findByTestId('detail-error')).textContent).toMatch(/no longer available/);
  });
});
