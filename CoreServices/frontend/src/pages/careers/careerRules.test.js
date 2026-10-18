import test from 'node:test';
import assert from 'node:assert/strict';
import { countsText, errorView, matchesFilters, relatedHint, skillNote, visibleResults } from './careerRules.js';

const r = (id, score, extra = {}) => ({
  profession_id: id, title: id, score, matched: 0, category: 'Development', source: 'onet',
  sources: [{ source: 'onet', profession_id: id }], categories: ['Development'], ...extra,
});
const RESULTS = [
  r('a', 40), r('b', 70), r('c', 10, { category: 'Design', categories: ['Design'] }),
  r('d', 55, { source: 'esco', sources: [{ source: 'esco', profession_id: 'd' }] }),
  r('e', 30, { sources: [{ source: 'onet' }, { source: 'esco' }], categories: ['Data & AI', 'Management & Product'] }),
];
const ids = (list) => list.map((x) => x.profession_id);

test('sorting: by match % both ways and by title', () => {
  assert.deepEqual(ids(visibleResults(RESULTS).shown), ['b', 'd', 'a', 'e', 'c']);
  assert.deepEqual(ids(visibleResults(RESULTS, { sort: 'score_asc' }).shown), ['c', 'e', 'a', 'd', 'b']);
  assert.deepEqual(ids(visibleResults(RESULTS, { sort: 'title' }).shown), ['a', 'b', 'c', 'd', 'e']);
});

test('filters: category matches either source of a merged role; source; minimum %', () => {
  assert.equal(matchesFilters(RESULTS[4], { category: 'Management & Product' }), true);
  assert.equal(matchesFilters(RESULTS[4], { category: 'Data & AI' }), true);
  assert.equal(matchesFilters(RESULTS[4], { source: 'esco' }), true); // merged O*NET + ESCO
  assert.deepEqual(ids(visibleResults(RESULTS, { source: 'esco' }).shown), ['d', 'e']);
  assert.deepEqual(ids(visibleResults(RESULTS, { minScore: 50 }).shown), ['b', 'd']);
});

test('at least 3 careers are always shown: the closest others top the list up', () => {
  const { shown, extra } = visibleResults(RESULTS, { category: 'Design' });
  assert.deepEqual(ids(shown), ['c']);
  assert.deepEqual(ids(extra), ['b', 'd']); // the best of the rest
  assert.equal(visibleResults(RESULTS, { minScore: 100 }).extra.length, 3);
  assert.equal(visibleResults(RESULTS).extra.length, 0);
  assert.equal(visibleResults([r('x', 5)], { minScore: 50 }).extra.length, 1); // never more than exist
});

test('every error code has its own safe view; only EMBEDDINGS_PENDING polls', () => {
  const kinds = ['EMBEDDINGS_PENDING', 'MODEL_LOADING', 'INDEX_BUILDING', 'NO_PROFESSIONS', 'MATCHING_UNAVAILABLE', 'MATCHING_TIMEOUT']
    .map((code) => errorView({ code }));
  assert.deepEqual(kinds.map((k) => k.kind), ['pending', 'starting', 'starting', 'unavailable', 'unavailable', 'timeout']);
  assert.deepEqual(kinds.map((k) => Boolean(k.poll)), [true, false, false, false, false, false]);
  assert.equal(new Set(kinds.map((k) => k.title)).size, 6);
  const generic = errorView(Object.assign(new Error('KeyError at service.py'), { code: 'SOMETHING' }));
  assert.equal(generic.kind, 'error');
  assert.doesNotMatch(generic.message, /KeyError|service\.py/);
});

test('skill notes say the status in words and name the user skill behind a related credit', () => {
  assert.equal(skillNote({ status: 'matched', via: { source: 'cv' } }), 'Held — found in your uploaded CV');
  assert.equal(skillNote({ status: 'related', via: { name: 'Express', source: 'github', similarity: 0.812 } }),
    'Related — via your Express (from your GitHub repositories), similarity 0.81');
  assert.equal(skillNote({ status: 'missing' }), 'Missing');
});

test('ESCO requirement groups (Module 5.1): held via one named skill, missing lists the alternatives', () => {
  const group = { phrase: 'use programming languages', alternatives: ['Kotlin', 'Swift', 'Java'] };
  assert.equal(skillNote({ status: 'matched', via: { name: 'Kotlin', source: 'cv', group: true }, group }),
    'Held via Kotlin, found in your uploaded CV (covers: use programming languages)');
  assert.equal(skillNote({ status: 'missing', group }), 'Missing — any one of: Kotlin, Swift, Java');
  // Holding the phrase itself, or a related credit, reads as before.
  assert.equal(skillNote({ status: 'matched', via: { source: 'manual' }, group }), 'Held — listed in your profile');
  assert.match(skillNote({ status: 'related', via: { name: 'Dart', source: 'cv', similarity: 0.8 }, group }), /^Related — via your Dart/);
});

test('Module 5.2: related hints are suggestions on missing skills only; counts drop "related" in exact mode', () => {
  const hinted = { status: 'missing', related_hint: { skill: 'React', similarity: 0.9 } };
  assert.equal(relatedHint(hinted), 'Related to your React');
  assert.equal(skillNote(hinted), 'Missing'); // the status itself never changes
  assert.equal(relatedHint({ status: 'matched', related_hint: { skill: 'React' } }), null);
  assert.equal(relatedHint({ status: 'missing' }), null);
  const r = { matched: 2, related: 0, missing: 3 };
  assert.equal(countsText(r, 'exact'), '2 held, 3 missing');
  assert.equal(countsText({ ...r, related: 1 }, 'related'), '2 held, 1 related, 3 missing');
});
