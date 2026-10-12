import { PROFILE_LIMITS as LIMITS } from '../constants/profileLimits.js';

// Copy of CoreServices/backend/validation/rules.js (only the import differs);
// tests/profileLimits.parity.test.js fails if the two drift apart.
// Each checker returns { value } (normalised) or { error } (user-facing text).

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// Strips control characters and trims. Single-line fields also turn tabs and
// line breaks into spaces; multi-line fields keep \n (normalised from \r\n).
export const cleanText = (v, { multiline = false } = {}) => {
  if (typeof v !== 'string') return v;
  const s = v.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
  return (multiline ? s : s.replace(/[\t\n]+/g, ' ')).trim();
};

// ── Dates ────────────────────────────────────────────────────────────────────
// Stored as "YYYY-MM", or "YYYY" when only the year is known (CV imports).
// "Present" is never stored: it becomes current=true with an empty end date.
export const PRESENT = 'present';
export const DATE_FORMAT_MESSAGE = 'Use a date like 2022-01, Jan 2022 or 2022';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const pad = (n) => String(n).padStart(2, '0');

export const currentMonth = (now = new Date()) => `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;

export const parseDate = (input, now = new Date()) => {
  if (input === undefined || input === null) return { value: '' };
  if (typeof input !== 'string') return { error: DATE_FORMAT_MESSAGE };
  const s = cleanText(input);
  if (!s) return { value: '' };
  if (LIMITS.dates.presentWords.includes(s.toLowerCase())) return { value: PRESENT };

  let year;
  let month = null;
  let m;
  if ((m = s.match(/^(\d{4})$/))) {
    year = +m[1];
  } else if ((m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?)?$/))) {
    year = +m[1];
    month = +m[2];
    if (m[3] !== undefined && (+m[3] < 1 || +m[3] > 31)) return { error: DATE_FORMAT_MESSAGE };
  } else if ((m = s.match(/^(\d{1,2})[-/.](\d{4})$/))) {
    year = +m[2];
    month = +m[1];
  } else if ((m = s.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) {
    const word = m[1].toLowerCase();
    const idx = MONTHS.findIndex((name) => name.startsWith(word));
    if (idx < 0) return { error: DATE_FORMAT_MESSAGE };
    year = +m[2];
    month = idx + 1;
  } else {
    return { error: DATE_FORMAT_MESSAGE };
  }

  if (month !== null && (month < 1 || month > 12)) return { error: 'Month must be between 01 and 12' };
  const maxYear = now.getUTCFullYear() + LIMITS.dates.educationEndFutureYears;
  if (year < LIMITS.dates.minYear || year > maxYear) {
    return { error: `Year must be between ${LIMITS.dates.minYear} and ${maxYear}` };
  }
  return { value: month === null ? String(year) : `${year}-${pad(month)}` };
};

// Compares two stored dates at the precision both have ("2019" vs "2019-06"
// compares by year). Negative: a is earlier; 0: same; positive: a is later.
export const compareDates = (a, b) => {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  if (ay !== by) return ay - by;
  if (!am || !bm) return 0;
  return am - bm;
};

export const isFutureDate = (value, now = new Date()) => compareDates(value, currentMonth(now)) > 0;

// ── Links ────────────────────────────────────────────────────────────────────
const HTTP_URL = new RegExp(LIMITS.httpUrlPattern);
const GITHUB_REPO_URL = new RegExp(LIMITS.githubRepoUrlPattern);
export const GITHUB_REPO_MESSAGE = 'Must be a GitHub repository link like https://github.com/owner/repo';

// '' stays ''. Bare domains ("linkedin.com/in/me") get https://; github.com
// links are canonicalised; any other scheme (javascript:, ftp:, …) is rejected.
export const normalizeUrl = (input) => {
  if (input === undefined || input === null) return { value: '' };
  if (typeof input !== 'string') return { error: 'Must be a link' };
  let s = cleanText(input);
  if (!s) return { value: '' };
  if (/\s/.test(s)) return { error: 'Links cannot contain spaces' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const looksLikeHostWithPort = /^[\w.-]+\.[a-z]{2,}:\d/i.test(s);
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !looksLikeHostWithPort) {
      return { error: 'Link must start with http:// or https://' };
    }
    s = `https://${s}`;
  }
  s = s
    .replace(/^([a-z][a-z0-9+.-]*):\/\//i, (_, scheme) => `${scheme.toLowerCase()}://`)
    .replace(/^https?:\/\/(?:www\.)?github\.com(?=\/|$)/i, 'https://github.com');
  if (s.length > LIMITS.urlMax) return { error: `Link must be at most ${LIMITS.urlMax} characters` };
  if (!HTTP_URL.test(s)) return { error: 'Must be a valid http(s) link' };
  return { value: s };
};

export const isGithubRepoUrl = (url) => GITHUB_REPO_URL.test(url);

// Project links: a github.com link must point at a repository; anything else
// just has to be a valid http(s) link (e.g. a live demo).
export const normalizeProjectUrl = (input, { githubOnly = false } = {}) => {
  const r = normalizeUrl(input);
  if (r.error || !r.value) return r;
  const onGithub = /^https:\/\/github\.com(\/|$)/.test(r.value);
  if ((githubOnly || onGithub) && !isGithubRepoUrl(r.value)) return { error: GITHUB_REPO_MESSAGE };
  return r;
};

// ── Phone / GitHub username ──────────────────────────────────────────────────
const PHONE = new RegExp(LIMITS.phone.pattern);
const GITHUB_USERNAME = new RegExp(LIMITS.githubUsername.pattern);

export const checkPhone = (input) => {
  if (input === undefined || input === null) return { value: '' };
  if (typeof input !== 'string') return { error: 'Phone must be text' };
  const s = cleanText(input).replace(/\s+/g, ' ');
  if (!s) return { value: '' };
  const { min, max, minDigits } = LIMITS.phone;
  if (s.length < min || s.length > max) return { error: `Phone must be ${min}–${max} characters` };
  if (!PHONE.test(s)) return { error: 'Phone may only contain digits, spaces, +, - and ( )' };
  if ((s.match(/\d/g) || []).length < minDigits) return { error: `Phone must contain at least ${minDigits} digits` };
  return { value: s };
};

export const checkGithubUsername = (input, { required = false } = {}) => {
  if (input === undefined || input === null) input = '';
  if (typeof input !== 'string') return { error: 'GitHub username must be text' };
  const s = cleanText(input);
  if (!s) return required ? { error: 'GitHub username is required' } : { value: '' };
  if (s.length > LIMITS.githubUsername.max) {
    return { error: `GitHub username must be at most ${LIMITS.githubUsername.max} characters` };
  }
  if (!GITHUB_USERNAME.test(s)) {
    return { error: 'GitHub username may only contain letters, numbers and single hyphens, and cannot start or end with a hyphen' };
  }
  return { value: s };
};

// ── Skills ───────────────────────────────────────────────────────────────────
// Empty entries are dropped (value ''); over-long ones are errors.
export const checkSkillName = (input) => {
  const raw = input && typeof input === 'object' && typeof input.name === 'string' ? input.name : input;
  if (typeof raw !== 'string') return { error: 'Skill must be text' };
  const s = cleanText(raw);
  if (s.length > LIMITS.skill.max) return { error: `Skill must be at most ${LIMITS.skill.max} characters` };
  return { value: s };
};

// Case-insensitive de-duplication across several lists; the first spelling wins.
export const dedupeAcross = (lists) => {
  const seen = new Set();
  return lists.map((list) =>
    list.filter((s) => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
};

// ── Name (FR5.1) ─────────────────────────────────────────────────────────────
// Lives on the User (auth register / account settings), not on the Profile.
export const checkName = (input) => {
  if (typeof input !== 'string') return { error: 'Name must be text' };
  const s = cleanText(input).replace(/\s+/g, ' ');
  const { min, max } = LIMITS.name;
  if (s.length < min || s.length > max) return { error: `Name must be ${min}–${max} characters` };
  return { value: s };
};
