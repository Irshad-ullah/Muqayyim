import test from 'node:test';
import assert from 'node:assert/strict';
import { aiStatusView, errorView, freshnessText, hoursText, moduleHoursText, moreText, progressText, timeline, weeksText } from './pathRules.js';

const m = (key, min, max) => ({ key, skill: key.toUpperCase(), hours: { min, max } });

test('timeline pours modules into weeks of the chosen hours, carrying a module over', () => {
  const weeks = timeline([m('a', 4, 6), m('b', 8, 12), m('c', 2, 2)], 6); // 5 h + 10 h + 2 h
  assert.deepEqual(weeks, [
    { week: 1, items: [{ key: 'a', skill: 'A', hours: 5 }, { key: 'b', skill: 'B', hours: 1 }] },
    { week: 2, items: [{ key: 'b', skill: 'B', hours: 6 }] },
    { week: 3, items: [{ key: 'b', skill: 'B', hours: 3 }, { key: 'c', skill: 'C', hours: 2 }] },
  ]);
  assert.equal(weeksText([m('a', 4, 6), m('b', 8, 12), m('c', 2, 2)], 6), 'about 3 weeks at 6 h per week');
  assert.deepEqual(timeline([{ key: 'x', skill: 'X' }], 5), []); // not enriched: no hours, no timeline
});

test('labels: estimated hours, progress, the 8-module cap and errors', () => {
  assert.equal(hoursText({ min: 10, max: 20 }), '10–20 h (estimated)');
  assert.equal(hoursText(undefined), 'time not estimated');
  assert.equal(progressText({ completed: 1, total: 3, percent: 33 }), '1 of 3 modules completed (33%)');
  assert.equal(moreText({ count: 2 }), '2 more skills — create the next path after this one');
  assert.equal(moreText({ count: 0 }), '');
  assert.equal(errorView({ code: 'PATH_LIMIT' }).kind, 'limit');
  assert.equal(errorView(new Error('KeyError')).kind, 'error');
});

test('the regenerate banner says what changed, and nothing when current or unknown', () => {
  assert.equal(freshnessText({ stale: true, profileChanged: true, dataChanged: false }), 'Your skills have changed since this path was made.');
  assert.equal(freshnessText({ stale: true, profileChanged: false, dataChanged: true }), 'The career data has been updated since this path was made.');
  assert.match(freshnessText({ stale: true, profileChanged: true, dataChanged: true }), /skills and the career data/);
  assert.equal(freshnessText({ stale: false }), '');
  assert.equal(freshnessText(null), '');
  assert.equal(errorView({ code: 'SUGGESTION_UNAVAILABLE' }).kind, 'suggestion');
});

test('the AI-details status line says what happened; estimates are never blank when the LLM gave them', () => {
  const path = (statuses, code = '') => ({ enrichment: { code }, modules: statuses.map((aiStatus, i) => ({ key: `m${i}`, aiStatus })) });
  assert.deepEqual(aiStatusView(path(['enriched', 'enriched'])), { kind: 'done', text: '', retry: false });
  assert.equal(aiStatusView(path(['enriched', 'pending'])).text, 'Getting AI details for 1 module…');
  assert.deepEqual(aiStatusView(path(['failed', 'enriched', 'failed'], 'LLM_INVALID_OUTPUT')),
    { kind: 'failed', text: 'AI details for 2 modules failed.', retry: true });
  assert.equal(aiStatusView(path(['failed'], 'LLM_TIMEOUT')).text, 'AI details for 1 module failed (the AI took too long).');
  assert.equal(aiStatusView(path(['failed'], 'LLM_DISABLED')).retry, false);
  assert.match(aiStatusView(path(['failed'], 'LLM_QUOTA_EXCEEDED')).text, /used today's AI requests/);
  assert.equal(moduleHoursText({ hours: { min: 4, max: 8 }, aiStatus: 'enriched' }), '4–8 h (estimated)');
  assert.equal(moduleHoursText({ aiStatus: 'pending' }), 'Estimating hours…');
  assert.equal(moduleHoursText({ aiStatus: 'failed' }), 'Estimated hours not available (AI details missing)');
});
