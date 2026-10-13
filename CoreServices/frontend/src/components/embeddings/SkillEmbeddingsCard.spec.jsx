import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

// jsdom has no layout: give the chart a fixed size.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => React.cloneElement(children, { width: 640, height: 320 }),
  };
});
vi.mock('../../services/embeddingService.js', () => ({
  embeddingService: { getMyEmbeddings: vi.fn(), getMySkillMap: vi.fn() },
}));

const { embeddingService } = await import('../../services/embeddingService.js');
const { default: SkillEmbeddingsCard } = await import('./SkillEmbeddingsCard.jsx');

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const err = (status, code, message) => Object.assign(new Error(message || code), { status, code });
const READY = { status: 'ready', skills_count: 4, described_count: 3, model: 'BAAI/bge-small-en-v1.5', text_mode: 'description', updated_at: '2026-10-13T09:00:00Z' };
const MAP = {
  points: [
    { name: 'React', x: -0.8, y: 0.2, source: 'manual' },
    { name: 'Next.js', x: -0.7, y: 0.3, source: 'cv' },
    { name: 'Docker', x: 0.9, y: -0.4, source: 'github' },
    { name: 'Accounting', x: 0.2, y: 1, source: 'manual' },
  ],
  closestPairs: [
    { a: 'React', b: 'Next.js', similarity: 0.71 },
    { a: 'Next.js', b: 'Docker', similarity: 0.42 },
    { a: 'React', b: 'Docker', similarity: 0.38 },
  ],
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('Skill embeddings card', () => {
  test('ready: status, count, model, scatter with labels and the closest pairs', async () => {
    embeddingService.getMyEmbeddings.mockResolvedValue(READY);
    embeddingService.getMySkillMap.mockResolvedValue(MAP);
    render(<SkillEmbeddingsCard />);

    expect((await screen.findByTestId('embedding-status')).textContent).toBe('Ready');
    expect(screen.getByTestId('skills-count').textContent).toBe('4');
    expect(screen.getByText('bge-small-en-v1.5')).toBeTruthy();
    expect(screen.getByTestId('described-count').textContent).toBe('3 of 4 skills described');

    const map = await screen.findByTestId('skill-map');
    await waitFor(() => expect(map.querySelectorAll('[data-testid="skill-map-label"]').length).toBe(4));
    const labels = [...map.querySelectorAll('[data-testid="skill-map-label"]')].map((t) => t.textContent);
    expect(labels).toEqual(expect.arrayContaining(['React', 'Next.js', 'Docker', 'Accounting']));
    expect(within(map).getByText('Added by you')).toBeTruthy(); // legend
    expect(within(screen.getByTestId('skill-map-list')).getByText(/Docker \(From GitHub\)/)).toBeTruthy();

    const pairs = within(screen.getByTestId('closest-pairs')).getAllByRole('listitem');
    expect(pairs.map((li) => li.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'React ↔ Next.js0.71',
      'Next.js ↔ Docker0.42',
      'React ↔ Docker0.38',
    ]);
    expect(screen.getByText(/Positions are an approximate 2D view; similarity values are exact\./)).toBeTruthy();
  });

  test('not yet created: explains when embeddings appear; map asks for 3 skills', async () => {
    embeddingService.getMyEmbeddings.mockResolvedValue({ status: 'none', skills_count: 0, model: READY.model, updated_at: null });
    embeddingService.getMySkillMap.mockRejectedValue(err(400, 'NOT_ENOUGH_SKILLS', 'Add at least 3 skills to see your skill map.'));
    render(<SkillEmbeddingsCard />);
    expect((await screen.findByTestId('embedding-status')).textContent).toBe('Not yet created');
    expect(screen.getByText('Embeddings are created when you add or update your skills.')).toBeTruthy();
    expect((await screen.findByTestId('map-not-enough')).textContent).toBe('Add at least 3 skills to see your skill map.');
    expect(embeddingService.getMySkillMap).toHaveBeenCalledTimes(1); // no retry for NOT_ENOUGH_SKILLS
  });

  test('pending: shows Processing, retries automatically and then shows the map', async () => {
    embeddingService.getMyEmbeddings
      .mockResolvedValueOnce({ ...READY, status: 'pending' })
      .mockResolvedValue(READY);
    embeddingService.getMySkillMap.mockRejectedValueOnce(err(503, 'EMBEDDINGS_PENDING')).mockResolvedValue(MAP);
    render(<SkillEmbeddingsCard retryMs={20} />);
    expect((await screen.findByTestId('embedding-status')).textContent).toBe('Processing');
    expect((await screen.findByTestId('map-pending')).textContent).toMatch(/being created/);
    expect(await screen.findByTestId('closest-pairs')).toBeTruthy();
    expect(screen.getByTestId('embedding-status').textContent).toBe('Ready');
    expect(embeddingService.getMySkillMap).toHaveBeenCalledTimes(2);
  });

  test('model loading: friendly message; retries stop after the time limit', async () => {
    embeddingService.getMyEmbeddings.mockResolvedValue({ ...READY, status: 'pending' });
    embeddingService.getMySkillMap.mockRejectedValue(err(503, 'MODEL_LOADING'));
    render(<SkillEmbeddingsCard retryMs={10} maxRetryMs={50} />);
    expect((await screen.findByTestId('map-pending')).textContent).toMatch(/still starting up/);
    await new Promise((r) => setTimeout(r, 200));
    const calls = embeddingService.getMySkillMap.mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(embeddingService.getMySkillMap.mock.calls.length).toBe(calls); // stopped
    expect(calls).toBeGreaterThan(1);
  });
});

describe('Skill map labels', () => {
  test('a label that would collide moves below its point', async () => {
    const { placeLabels } = await import('./SkillMap.jsx');
    const placed = placeLabels([
      { name: 'Machine Learning', x: -0.1, y: -0.8 },
      { name: 'Accounting', x: -0.05, y: -0.85 },
      { name: 'React', x: 0.9, y: 0.9 },
    ]);
    expect(placed.map((p) => p.below)).toEqual([false, true, false]);
  });
});
