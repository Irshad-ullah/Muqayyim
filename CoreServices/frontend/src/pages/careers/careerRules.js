// Framework-free rules for the Career Matching page (unit-tested with `node --test`):
// sorting and filtering (FR7.8), the "at least 3 results" rule (FR7.3), error views (FR7.10)
// and the labels for held / related / missing skills.

export const MIN_SHOWN = 3;

export const SORTS = {
  score_desc: { label: 'Match % (highest first)', compare: (a, b) => b.score - a.score || b.matched - a.matched || a.title.localeCompare(b.title) },
  score_asc: { label: 'Match % (lowest first)', compare: (a, b) => a.score - b.score || a.title.localeCompare(b.title) },
  title: { label: 'Title (A–Z)', compare: (a, b) => a.title.localeCompare(b.title) || b.score - a.score },
};

export const SOURCE_NAMES = { onet: 'O*NET', esco: 'ESCO', curated: 'Curated', manual: 'Manual' };

export const sourcesOf = (result) => (result.sources?.length ? result.sources.map((s) => s.source) : [result.source]);
export const categoriesOf = (result) => (result.categories?.length ? result.categories : [result.category || 'Other']);

export const categoryOptions = (results) => [...new Set((results || []).flatMap(categoriesOf))].sort();
export const sourceOptions = (results) => [...new Set((results || []).flatMap(sourcesOf))].sort();

export const matchesFilters = (result, { category = '', source = '', minScore = 0 } = {}) =>
  (!category || categoriesOf(result).includes(category)) &&
  (!source || sourcesOf(result).includes(source)) &&
  result.score >= Number(minScore || 0);

/**
 * → { shown, extra }: `shown` = the results that pass the filters, sorted; `extra` = the best
 * other results (by match %) added so at least MIN_SHOWN careers are always on screen (FR7.3).
 */
export const visibleResults = (results, { sort = 'score_desc', ...filters } = {}) => {
  const all = results || [];
  const compare = (SORTS[sort] || SORTS.score_desc).compare;
  const shown = all.filter((r) => matchesFilters(r, filters)).sort(compare);
  const missing = Math.max(0, Math.min(MIN_SHOWN, all.length) - shown.length);
  const ids = new Set(shown.map((r) => r.profession_id));
  const extra = all
    .filter((r) => !ids.has(r.profession_id))
    .sort(SORTS.score_desc.compare)
    .slice(0, missing);
  return { shown, extra };
};

export const STATUS_VIEW = {
  matched: { label: 'Held', symbol: '✓' },
  related: { label: 'Related', symbol: '≈' },
  missing: { label: 'Missing', symbol: '✗' },
};

const FROM = { manual: 'your profile', cv: 'your CV', github: 'GitHub' };
export const fromLabel = (source) => FROM[source] || 'your profile';

// One required / optional skill row → the text shown next to its icon (never colour alone).
// An ESCO requirement group (Module 5.1) is held through any one of its named skills.
export const skillNote = (row) => {
  if (row.status === 'matched' && row.via?.group && row.group) {
    return `Held via ${row.via.name} (shows: ${row.group.phrase})`;
  }
  if (row.status === 'matched') return `Held — from ${fromLabel(row.via?.source)}`;
  if (row.status === 'missing' && row.group?.alternatives?.length) {
    return `Missing — any one of: ${row.group.alternatives.join(', ')}`;
  }
  if (row.status === 'related' && row.via) {
    return `Related — via your ${row.via.name} (from ${fromLabel(row.via.source)}), similarity ${Number(row.via.similarity).toFixed(2)}`;
  }
  return 'Missing';
};

// Module 5.2: with related credit off, a missing skill can carry a related hint — a suggestion only, never credit.
export const relatedHint = (row) => (row.status === 'missing' && row.related_hint?.skill
  ? `Related to your ${row.related_hint.skill}` : null);

// "x held, y related, z missing" — the related count only exists when related credit is on.
export const countsText = ({ matched, related, missing }, scoringMode) => (scoringMode === 'exact'
  ? `${matched} held, ${missing} missing` : `${matched} held, ${related} related, ${missing} missing`);

export const ESCO_NOTE = 'ESCO lists broader competences, so scores for ESCO roles tend to be lower than for O*NET roles.';

// An error from the service → what the page shows (FR7.10: never internal details).
export const errorView = (error) => {
  const code = error?.code;
  const retryAfter = error?.retryAfterSeconds;
  switch (code) {
    case 'EMBEDDINGS_PENDING':
      return { kind: 'pending', title: 'Your skills are being analysed',
        message: 'We are preparing your skills for matching. This page updates by itself in a moment.', poll: true, retryAfter };
    case 'MODEL_LOADING':
      return { kind: 'starting', title: 'Matching is starting up',
        message: 'The skill model is loading. Please try again in a few seconds.', retryAfter };
    case 'INDEX_BUILDING':
      return { kind: 'starting', title: 'The career database is being prepared',
        message: 'Please try again in a few seconds.', retryAfter };
    case 'NO_PROFESSIONS':
      return { kind: 'unavailable', title: 'No careers available yet',
        message: 'The career database is empty at the moment. Please try again later.', retryAfter };
    case 'MATCHING_UNAVAILABLE':
      return { kind: 'unavailable', title: 'Career matching is unavailable',
        message: 'The matching service is not reachable right now. Please try again shortly.', retryAfter };
    case 'MATCHING_TIMEOUT':
      return { kind: 'timeout', title: 'This took too long',
        message: 'Career matching did not respond in time. Please try again.' };
    case 'PROFESSION_NOT_FOUND':
      return { kind: 'not_found', title: 'Career not found', message: 'This career is no longer available.' };
    default:
      return { kind: 'error', title: 'Something went wrong',
        message: 'We could not load your career matches. Please try again.' };
  }
};

export const formatScore = (score) => `${Math.round(Number(score) || 0)}%`;
