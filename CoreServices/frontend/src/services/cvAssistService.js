// Module 4 — AI writing assistance for CV text fields (12 Part 2). Framework-free (node --test).
//
// React → API Gateway → CoreServices /api/ai/cv-assist → AIServices → LLM provider.
// The browser sends only which section it is (summary / one experience entry / one project), the
// entry's allowed fields and the current text. CoreServices checks consent and adds the profile
// facts on the server; contact details are never sent. The AI may only reword the user's own
// facts; anything it adds that the input lacks comes back as a flag and is shown in the review step.
// Nothing is saved automatically: an accepted suggestion only replaces the editor text.

export const TARGETS = { summary: 'summary', experience: 'experience', project: 'project' };

// The request for one Generate / Improve click.
export const assistRequest = (target, mode, { entry, currentText } = {}) => {
  const body = { target, mode, currentText: (currentText || '').slice(0, 4000) };
  if (target === TARGETS.experience) {
    const { title, company, startDate, endDate, current } = entry || {};
    body.entry = { title, company, startDate, endDate, current: Boolean(current) };
  }
  if (target === TARGETS.project) {
    const { name, technologies } = entry || {};
    body.entry = { name, technologies: technologies || [] };
  }
  return body;
};

// Errors → the message shown next to the buttons; the user's text is never changed.
export const UNCHANGED = 'Your text was not changed.';
export const assistErrorView = (error) => {
  switch (error?.code) {
    case 'AI_CONSENT_REQUIRED':
      return { kind: 'consent', message: 'Please review the AI notice first.' };
    case 'LLM_QUOTA_EXCEEDED':
      return { kind: 'quota', message: 'AI daily limit reached, try again tomorrow.' };
    case 'LLM_RATE_LIMITED':
      return { kind: 'busy', message: 'AI is busy, try again in a minute.' };
    default: // LLM_UNAVAILABLE / LLM_TIMEOUT / LLM_DISABLED / LLM_INVALID_OUTPUT / network
      return { kind: 'unavailable', message: 'AI is unavailable.' };
  }
};

// A suggestion split into plain and flagged parts, for highlighting in the review step.
export const flagSegments = (text, flags) => {
  const valid = (flags || [])
    .filter((f) => Number.isInteger(f.start) && Number.isInteger(f.end) && f.start >= 0 && f.end <= text.length && f.start < f.end)
    .sort((a, b) => a.start - b.start);
  const out = [];
  let at = 0;
  for (const flag of valid) {
    if (flag.start < at) continue; // overlapping flags: keep the first
    if (flag.start > at) out.push({ text: text.slice(at, flag.start) });
    out.push({ text: text.slice(flag.start, flag.end), flag });
    at = flag.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
};
