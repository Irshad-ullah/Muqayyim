import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/aiService.js', () => ({
  aiService: { getStatus: vi.fn(), getConsent: vi.fn(), giveConsent: vi.fn(), withdrawConsent: vi.fn(), cvAssist: vi.fn() },
}));

const { aiService } = await import('../../services/aiService.js');
const { CvAssistActions, CvAssistProvider } = await import('./CvAssist.jsx');

const TEXT = 'Your CV/profile text is sent to Google Gemini for processing. On the free tier, Google may use this content to improve its products.';
const consent = (granted) => ({ granted, version: granted ? 'v1' : null, currentVersion: 'v1', provider: 'Google Gemini', text: TEXT });
const SUGGESTION = 'Built REST APIs at Google using Kubernetes.';
const span = (word) => ({ start: SUGGESTION.indexOf(word), end: SUGGESTION.indexOf(word) + word.length });
const FLAGS = [
  { text: 'Google', reason: 'employer not in your profile', ...span('Google') },
  { text: 'Kubernetes', reason: 'skill not in your profile', ...span('Kubernetes') },
];
const httpError = (code, status) => Object.assign(new Error('x'), { code, status });

let applied;
const renderActions = (props = {}) => render(
  <CvAssistProvider>
    <CvAssistActions target="experience" entry={{ title: 'Backend Developer', company: 'Acme Labs' }} currentText="Built APIs."
      onApply={(v) => applied.push(v)} {...props} />
  </CvAssistProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  applied = [];
  aiService.getStatus.mockResolvedValue({ available: true });
  aiService.getConsent.mockResolvedValue(consent(true));
  aiService.giveConsent.mockResolvedValue(consent(true));
  aiService.cvAssist.mockResolvedValue({ suggestion: SUGGESTION, insufficientData: false, flags: FLAGS });
});
afterEach(cleanup);

const button = (name) => screen.findByRole('button', { name });

describe('consent', () => {
  test('first use shows the exact free-tier notice; "Not now" closes it and changes nothing', async () => {
    const user = userEvent.setup();
    aiService.getConsent.mockResolvedValue(consent(false));
    renderActions();
    await user.click(await button('Generate'));
    const dialog = await screen.findByTestId('ai-consent-dialog');
    expect(within(dialog).getByTestId('ai-consent-text').textContent).toBe(TEXT);
    expect(dialog.textContent).toMatch(/name, e-mail, phone number, address, links and photo are never sent/);
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('ai-consent-dialog')).toBeNull();
    expect(aiService.giveConsent).not.toHaveBeenCalled();
    expect(aiService.cvAssist).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
    expect((await button('Generate')).disabled).toBe(false); // still usable later
  });

  test('"Agree" stores consent for the current notice and continues to the suggestion', async () => {
    const user = userEvent.setup();
    aiService.getConsent.mockResolvedValue(consent(false));
    renderActions();
    await user.click(await button('Generate'));
    await user.click(within(await screen.findByTestId('ai-consent-dialog')).getByRole('button', { name: 'Agree' }));
    expect(aiService.giveConsent).toHaveBeenCalledWith('v1');
    expect(await screen.findByTestId('assist-review')).toBeTruthy();
    expect(aiService.cvAssist).toHaveBeenCalledWith({ target: 'experience', mode: 'generate', currentText: 'Built APIs.',
      entry: { title: 'Backend Developer', company: 'Acme Labs', startDate: undefined, endDate: undefined, current: false } });
  });
});

describe('review step', () => {
  test('current text and suggestion side by side, flagged items highlighted with the reason', async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(await button('Improve'));
    const review = await screen.findByTestId('assist-review');
    expect(within(review).getByTestId('review-current').textContent).toBe('Built APIs.');
    expect(within(review).getByTestId('review-suggestion').textContent).toContain('Built REST APIs at');
    const marks = within(review).getAllByTestId('flagged');
    expect(marks.map((m) => [m.textContent.split(' (')[0], m.getAttribute('title')])).toEqual([
      ['Google', 'employer not in your profile'], ['Kubernetes', 'skill not in your profile']]);
    expect(within(review).getByTestId('review-flags').textContent).toMatch(/Google — employer not in your profile/);
    expect(applied).toEqual([]); // nothing applied, nothing saved
  });

  test('Accept puts the suggestion into the editor; Discard keeps the user text', async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(await button('Improve'));
    await user.click(within(await screen.findByTestId('assist-review')).getByRole('button', { name: 'Discard' }));
    expect(applied).toEqual([]);
    await user.click(await button('Improve'));
    await user.click(within(await screen.findByTestId('assist-review')).getByRole('button', { name: 'Accept' }));
    expect(applied).toEqual([SUGGESTION]);
    expect(screen.queryByTestId('assist-review')).toBeNull();
  });

  test('Edit before accepting', async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(await button('Improve'));
    const review = await screen.findByTestId('assist-review');
    await user.click(within(review).getByRole('button', { name: 'Edit before accepting' }));
    const box = within(review).getByLabelText('Edit the suggestion');
    await user.clear(box);
    await user.type(box, 'Built REST APIs with Python.');
    await user.click(within(review).getByRole('button', { name: 'Accept' }));
    expect(applied).toEqual(['Built REST APIs with Python.']);
  });

  test('not enough information: a notice, no review, text unchanged', async () => {
    const user = userEvent.setup();
    aiService.cvAssist.mockResolvedValue({ suggestion: '', insufficientData: true, flags: [] });
    renderActions();
    await user.click(await button('Generate'));
    expect((await screen.findByTestId('assist-notice')).textContent).toMatch(/not enough information.*Your text was not changed/);
    expect(screen.queryByTestId('assist-review')).toBeNull();
  });
});

describe('limits and outages leave the text untouched', () => {
  test.each([
    ['LLM_QUOTA_EXCEEDED', 429, 'AI daily limit reached, try again tomorrow. Your text was not changed.'],
    ['LLM_RATE_LIMITED', 429, 'AI is busy, try again in a minute. Your text was not changed.'],
    ['LLM_UNAVAILABLE', 503, 'AI is unavailable. Your text was not changed.'],
    ['LLM_TIMEOUT', 504, 'AI is unavailable. Your text was not changed.'],
  ])('%s', async (code, status, message) => {
    const user = userEvent.setup();
    aiService.cvAssist.mockRejectedValue(httpError(code, status));
    renderActions();
    await user.click(await button('Improve'));
    expect((await screen.findByTestId('assist-notice')).textContent).toBe(message);
    expect(applied).toEqual([]);
    expect(screen.queryByTestId('assist-review')).toBeNull();
  });

  test('AI unavailable: the buttons are disabled with the reason', async () => {
    aiService.getStatus.mockResolvedValue({ available: false });
    renderActions();
    await waitFor(async () => expect((await button('Generate')).disabled).toBe(true));
    expect((await button('Generate')).getAttribute('title')).toBe('AI is unavailable right now');
  });

  test('Improve needs some text first', async () => {
    renderActions({ currentText: '' });
    await waitFor(async () => expect((await button('Generate')).disabled).toBe(false));
    expect((await button('Improve')).disabled).toBe(true);
  });
});
