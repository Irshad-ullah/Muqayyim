import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/aiService.js', () => ({
  aiService: { getConsent: vi.fn(), giveConsent: vi.fn(), withdrawConsent: vi.fn() },
}));

const { aiService } = await import('../../services/aiService.js');
const { default: AiConsentCard } = await import('./AiConsentCard.jsx');

const TEXT = 'Your CV/profile text is sent to Google Gemini for processing. On the free tier, Google may use this content to improve its products.';
const state = (granted) => ({ granted, version: 'v1', currentVersion: 'v1', text: TEXT, grantedAt: granted ? '2026-10-17T10:00:00Z' : null });

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('Account page — AI writing help', () => {
  test('withdrawing asks for confirmation, then turns AI off (cached suggestions deleted on the server)', async () => {
    const user = userEvent.setup();
    aiService.getConsent.mockResolvedValue(state(true));
    aiService.withdrawConsent.mockResolvedValue(state(false));
    render(<AiConsentCard />);
    expect((await screen.findByTestId('ai-consent-status')).textContent).toMatch(/^On — you agreed on/);
    expect(screen.getByText(TEXT)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Withdraw consent' }));
    expect(screen.getByRole('alertdialog').textContent).toMatch(/deletes your saved AI suggestions/);
    expect(aiService.withdrawConsent).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole('button', { name: 'Withdraw consent' }).at(-1));
    expect(aiService.withdrawConsent).toHaveBeenCalledTimes(1);
    expect((await screen.findByTestId('ai-consent-status')).textContent).toMatch(/^Off/);
    expect(screen.getByRole('status').textContent).toMatch(/being deleted/);
  });

  test('giving consent from the Account page', async () => {
    const user = userEvent.setup();
    aiService.getConsent.mockResolvedValue(state(false));
    aiService.giveConsent.mockResolvedValue(state(true));
    render(<AiConsentCard />);
    await user.click(await screen.findByRole('button', { name: 'Agree and turn on' }));
    expect(aiService.giveConsent).toHaveBeenCalledWith('v1');
    expect((await screen.findByTestId('ai-consent-status')).textContent).toMatch(/^On/);
  });
});
