// Framework-free rules for the learning-path pages (Module 6; unit-tested with `node --test`): the week-by-week
// timeline from the hours per week, progress, status and hour labels, and the error views (FR8.9).

export const STATUS_VIEW = {
  not_started: { label: 'Not started', tone: 'bg-slate-100 text-slate-700' },
  in_progress: { label: 'In progress', tone: 'bg-amber-100 text-amber-800' },
  completed: { label: 'Completed', tone: 'bg-emerald-100 text-emerald-800' },
};

export const hoursText = (hours) => (hours?.min ? `${hours.min}–${hours.max} h (estimated)` : 'time not estimated');

// The middle of each module's estimate, so a 10–20 h module counts as 15 h.
const moduleHours = (m) => (m.hours?.min ? (m.hours.min + m.hours.max) / 2 : 0);

/**
 * Week-by-week plan: modules in path order are poured into weeks of `hoursPerWeek` hours. A module that does not fit
 * in the rest of a week continues into the next. → [{ week, items: [{ key, skill, hours }] }]
 */
export const timeline = (modules, hoursPerWeek) => {
  const perWeek = Math.max(1, Number(hoursPerWeek) || 5);
  const weeks = [];
  let week = 1;
  let left = perWeek;
  for (const m of modules || []) {
    let remaining = moduleHours(m);
    if (!remaining) continue;
    while (remaining > 0) {
      const used = Math.min(remaining, left);
      const current = weeks[week - 1] || (weeks[week - 1] = { week, items: [] });
      current.items.push({ key: m.key, skill: m.skill, hours: Math.round(used * 10) / 10 });
      remaining -= used;
      left -= used;
      if (left <= 0) {
        week += 1;
        left = perWeek;
      }
    }
  }
  return weeks;
};

export const weeksText = (modules, hoursPerWeek) => {
  const n = timeline(modules, hoursPerWeek).length;
  return n ? `about ${n} week${n === 1 ? '' : 's'} at ${hoursPerWeek} h per week` : '';
};

export const progressText = (progress) =>
  `${progress?.completed || 0} of ${progress?.total || 0} modules completed (${progress?.percent || 0}%)`;

export const moreText = (more) =>
  more?.count ? `${more.count} more skill${more.count === 1 ? '' : 's'} — create the next path after this one` : '';

// The "Regenerate?" banner: why the path may be out of date (empty when it is current or unknown).
export const freshnessText = (f) => {
  if (!f?.stale) return '';
  if (f.profileChanged && f.dataChanged) return 'Your skills and the career data have changed since this path was made.';
  return f.profileChanged ? 'Your skills have changed since this path was made.' : 'The career data has been updated since this path was made.';
};

export const errorView = (error) => {
  switch (error?.code) {
    case 'AI_CONSENT_REQUIRED':
      return { kind: 'consent', title: 'Agree to the AI notice first', message: 'Learning paths use AI to describe each module and suggest resources.' };
    case 'PATH_EXISTS':
      return { kind: 'exists', title: 'You already have a path for this career', message: 'Open it from your learning paths.' };
    case 'PATH_LIMIT':
      return { kind: 'limit', title: 'You have 5 learning paths', message: 'Delete one before creating another.' };
    case 'EMBEDDINGS_PENDING':
    case 'MODEL_LOADING':
    case 'INDEX_BUILDING':
      return { kind: 'starting', title: 'Your skills are still being prepared', message: 'Please try again in a moment.' };
    case 'PROFESSION_NOT_FOUND':
      return { kind: 'not_found', title: 'Career not found', message: 'This career is no longer available.' };
    case 'PATH_NOT_FOUND':
      return { kind: 'not_found', title: 'Learning path not found', message: 'It may have been deleted.' };
    case 'INVALID_CHOICE':
      return { kind: 'choice', title: 'Your choice is no longer offered', message: 'Create a new path for this career to choose again.' };
    case 'SUGGESTION_UNAVAILABLE':
      return { kind: 'suggestion', title: 'No new suggestion right now', message: 'Please try again later.' };
    case 'MORE_LIMIT':
      return { kind: 'limit', title: 'This module has 10 resources', message: 'That is the most a module can list.' };
    default:
      return { kind: 'error', title: 'Something went wrong', message: 'The learning path could not be loaded or created. Please try again.' };
  }
};
