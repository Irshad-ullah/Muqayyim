import test from 'node:test';
import assert from 'node:assert/strict';
import { assistErrorView, assistRequest, flagSegments, UNCHANGED } from './cvAssistService.js';

test('the request carries the section, the action, allowed entry fields and the current text only', () => {
  assert.deepEqual(assistRequest('summary', 'generate', { currentText: 'Backend developer.' }),
    { target: 'summary', mode: 'generate', currentText: 'Backend developer.' });
  const experience = assistRequest('experience', 'improve', {
    currentText: 'Built APIs.',
    entry: { id: 'x1', title: 'Backend Developer', company: 'Acme Labs', location: 'Islamabad', startDate: '2021', endDate: '', current: true,
      description: 'Built APIs.', email: 'a@b.com' },
  });
  assert.deepEqual(experience.entry, { title: 'Backend Developer', company: 'Acme Labs', startDate: '2021', endDate: '', current: true });
  const project = assistRequest('project', 'generate', { entry: { name: 'Muqayyim', technologies: ['React'], url: 'https://x.dev', liveUrl: 'https://y.dev' } });
  assert.deepEqual(project.entry, { name: 'Muqayyim', technologies: ['React'] });
  assert.equal(assistRequest('summary', 'improve', { currentText: 'x'.repeat(5000) }).currentText.length, 4000);
});

test('limit and outage messages are the agreed wording', () => {
  assert.equal(assistErrorView({ code: 'LLM_QUOTA_EXCEEDED' }).message, 'AI daily limit reached, try again tomorrow.');
  assert.equal(assistErrorView({ code: 'LLM_RATE_LIMITED' }).message, 'AI is busy, try again in a minute.');
  for (const code of ['LLM_UNAVAILABLE', 'LLM_TIMEOUT', 'LLM_DISABLED', 'LLM_INVALID_OUTPUT', undefined]) {
    assert.equal(assistErrorView({ code }).message, 'AI is unavailable.', String(code));
  }
  assert.equal(assistErrorView({ code: 'AI_CONSENT_REQUIRED' }).kind, 'consent');
  assert.equal(UNCHANGED, 'Your text was not changed.');
});

test('flag segments split a suggestion into plain and flagged parts', () => {
  const text = 'Built APIs at Google using Kubernetes.';
  const at = (word) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length });
  const parts = flagSegments(text, [
    { text: 'Kubernetes', reason: 'skill not in your profile', ...at('Kubernetes') },
    { text: 'Google', reason: 'employer not in your profile', ...at('Google') },
    { text: 'bad', reason: 'x', start: 30, end: 99 }, // out of range: ignored
  ]);
  assert.deepEqual(parts.map((p) => [p.text, p.flag?.reason || null]), [
    ['Built APIs at ', null], ['Google', 'employer not in your profile'], [' using ', null],
    ['Kubernetes', 'skill not in your profile'], ['.', null],
  ]);
  assert.equal(parts.map((p) => p.text).join(''), text);
  assert.deepEqual(flagSegments('plain', []), [{ text: 'plain' }]);
});
