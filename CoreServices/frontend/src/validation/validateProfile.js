import { PROFILE_LIMITS as L } from '../constants/profileLimits.js';
import {
  PRESENT,
  checkGithubUsername,
  checkPhone,
  checkSkillName,
  cleanText,
  compareDates,
  dedupeAcross,
  isFutureDate,
  normalizeProjectUrl,
  normalizeUrl,
  parseDate,
} from './profileRules.js';

// Client-side profile checks: the same rules and the same error paths as the
// server (backend/validation/profileSchemas.js), so problems show inline before
// saving. The server stays the authority; its errors use the same paths.
// Not checked here: projects.selected (derived from the other project lists
// at save time) and server-generated data (cvData, GitHub repos).

const isStr = (v) => typeof v === 'string';

export const makeCollector = () => {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });

  const text = (field, value, label, max, { required = false, multiline = false } = {}) => {
    const v = value === undefined || value === null ? '' : value;
    if (!isStr(v)) return add(field, `${label} must be text`);
    const s = cleanText(v, { multiline });
    if (s.length > max) add(field, `${label} must be at most ${max} characters`);
    if (required && !s) add(field, `${label} is required`);
    return undefined;
  };

  const rule = (field, result) => {
    if (result.error) {
      add(field, result.error);
      return undefined;
    }
    return result.value;
  };

  const list = (field, value, max, label) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      add(field, `${label} must be a list`);
      return null;
    }
    if (value.length > max) add(field, `You can add at most ${max} ${label.toLowerCase()}`);
    return value;
  };

  const object = (field, value, label) => {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
      add(field, `${label} must be an object`);
      return null;
    }
    return value;
  };

  // Skill-like lists: returns the cleaned, de-duplicated names.
  const strings = (field, value, label, maxItems = Infinity) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      add(field, `${label} must be a list`);
      return null;
    }
    const out = [];
    value.forEach((item, i) => {
      const r = checkSkillName(item);
      if (r.error) add(`${field}[${i}]`, r.error);
      else if (r.value) out.push(r.value);
    });
    const [unique] = dedupeAcross([out]);
    if (unique.length > maxItems) add(field, `You can add at most ${maxItems} ${label.toLowerCase()}`);
    return unique;
  };

  return { errors, add, text, rule, list, object, strings };
};

const date = (c, field, value) => c.rule(field, parseDate(value));

// ── Entries ──────────────────────────────────────────────────────────────────
export const checkExperience = (c, p, e) => {
  if (!(e = c.object(p, e, 'Experience entry'))) return;
  c.text(`${p}.title`, e.title, 'Job title', L.titleMax, { required: true });
  c.text(`${p}.company`, e.company, 'Company', L.orgMax, { required: true });
  c.text(`${p}.location`, e.location, 'Location', L.locationMax);
  c.text(`${p}.description`, e.description, 'Description', L.descriptionMax, { multiline: true });
  if (e.current !== undefined && e.current !== null && typeof e.current !== 'boolean') c.add(`${p}.current`, 'Current must be true or false');
  const start = date(c, `${p}.startDate`, e.startDate);
  const end = date(c, `${p}.endDate`, e.endDate);
  const startOk = isStr(start) && start && start !== PRESENT;
  if (isStr(start)) {
    if (!start) c.add(`${p}.startDate`, 'Start date is required');
    else if (start === PRESENT) c.add(`${p}.startDate`, 'Start date must be a month or year, not "Present"');
    else if (isFutureDate(start)) c.add(`${p}.startDate`, 'Start date cannot be in the future');
  }
  const current = e.current === true || end === PRESENT;
  if (isStr(end) && !current) {
    if (!end) c.add(`${p}.endDate`, 'End date is required unless this is your current role');
    else if (isFutureDate(end)) c.add(`${p}.endDate`, 'End date cannot be in the future');
    else if (startOk && !isFutureDate(start) && compareDates(start, end) > 0) c.add(`${p}.endDate`, 'End date must be after the start date');
  }
};

export const checkEducation = (c, p, e) => {
  if (!(e = c.object(p, e, 'Education entry'))) return;
  c.text(`${p}.institution`, e.institution, 'Institution', L.orgMax, { required: true });
  c.text(`${p}.degree`, e.degree, 'Degree', L.titleMax, { required: true });
  c.text(`${p}.field`, e.field, 'Field of study', L.titleMax);
  c.text(`${p}.gpa`, e.gpa, 'GPA', L.gpaMax);
  const start = date(c, `${p}.startDate`, e.startDate);
  const end = date(c, `${p}.endDate`, e.endDate);
  if (start === PRESENT) c.add(`${p}.startDate`, 'Start date must be a month or year, not "Present"');
  if (isStr(start) && isStr(end) && start && end && start !== PRESENT && end !== PRESENT && compareDates(start, end) > 0) {
    c.add(`${p}.endDate`, 'End date must be after the start date');
  }
};

export const checkCertification = (c, p, x) => {
  if (!(x = c.object(p, x, 'Certification'))) return;
  c.text(`${p}.name`, x.name, 'Certification name', L.titleMax, { required: true });
  c.text(`${p}.issuer`, x.issuer, 'Issuer', L.orgMax, { required: true });
  c.rule(`${p}.url`, normalizeUrl(x.url));
  const d = date(c, `${p}.date`, x.date);
  if (d === PRESENT) c.add(`${p}.date`, 'Use the month or year you earned it');
  else if (isStr(d) && d && isFutureDate(d)) c.add(`${p}.date`, 'Date cannot be in the future');
};

export const checkProject = (c, p, x, { githubOnly = false, label = 'Project name' } = {}) => {
  if (!(x = c.object(p, x, 'Project'))) return;
  c.text(`${p}.name`, x.name, label, L.titleMax, { required: true });
  c.text(`${p}.description`, x.description, 'Description', L.descriptionMax, { multiline: true });
  c.rule(`${p}.url`, normalizeProjectUrl(x.url, { githubOnly }));
};

// ── Whole profile ────────────────────────────────────────────────────────────
// Validates the sections present in `profile`; returns [{ field, message }].
export const validateProfile = (profile = {}) => {
  const c = makeCollector();

  if (profile.personalInfo !== undefined) {
    const pi = c.object('personalInfo', profile.personalInfo, 'Personal info');
    if (pi) {
      c.rule('personalInfo.phone', checkPhone(pi.phone));
      c.text('personalInfo.location', pi.location, 'Location', L.locationMax);
      ['website', 'linkedin', 'github'].forEach((k) => c.rule(`personalInfo.${k}`, normalizeUrl(pi[k])));
    }
  }

  if (profile.summary !== undefined) c.text('summary', profile.summary, 'Summary', L.summaryMax, { multiline: true });

  const entries = (key, max, label, check) => {
    if (profile[key] === undefined) return;
    const items = c.list(key, profile[key], max, label);
    items?.forEach((e, i) => check(c, `${key}[${i}]`, e));
  };
  entries('experience', L.maxEntries.experience, 'Experience entries', checkExperience);
  entries('education', L.maxEntries.education, 'Education entries', checkEducation);
  entries('certifications', L.maxEntries.certifications, 'Certifications', checkCertification);

  if (profile.skills !== undefined) {
    const s = c.object('skills', profile.skills, 'Skills');
    if (s) {
      const lists = ['manual', 'cv', 'extracted'].map((k) => c.strings(`skills.${k}`, s[k], 'Skills'));
      if (lists.every(Array.isArray)) {
        const total = dedupeAcross(lists).reduce((n, l) => n + l.length, 0);
        if (total > L.skill.maxTotal) c.add('skills', `You can have at most ${L.skill.maxTotal} skills (you have ${total})`);
      }
    }
  }

  if (profile.projects !== undefined) {
    const pr = c.object('projects', profile.projects, 'Projects');
    if (pr) {
      const max = L.maxEntries.projects;
      c.list('projects.manual', pr.manual, max, 'Projects')?.forEach((x, i) => {
        checkProject(c, `projects.manual[${i}]`, x);
        if (x && typeof x === 'object') c.strings(`projects.manual[${i}].technologies`, x.technologies, 'Technologies', L.technologiesMax);
      });
      c.list('projects.github', pr.github, max, 'GitHub projects')?.forEach((x, i) => {
        checkProject(c, `projects.github[${i}]`, x, { githubOnly: true, label: 'Repository name' });
      });
      c.list('projects.cv', pr.cv, max, 'CV projects')?.forEach((x, i) => {
        if (!(x = c.object(`projects.cv[${i}]`, x, 'Project'))) return;
        c.text(`projects.cv[${i}].name`, x.name, 'Project name', L.titleMax, { required: true });
        c.text(`projects.cv[${i}].description`, x.description, 'Description', L.descriptionMax, { multiline: true });
        c.strings(`projects.cv[${i}].technologies`, x.technologies, 'Technologies', L.technologiesMax);
      });
    }
  }

  if (profile.githubData !== undefined) {
    const g = c.object('githubData', profile.githubData, 'GitHub data');
    if (g) c.rule('githubData.username', checkGithubUsername(g.username));
  }

  return c.errors;
};

// ── Mapping errors to the wizard ─────────────────────────────────────────────
export const sectionOf = (field) => String(field).split(/[.[]/)[0];

export const STEP_FOR_SECTION = {
  personalInfo: 'basic',
  summary: 'basic',
  certifications: 'basic',
  experience: 'cv',
  education: 'cv',
  cvData: 'cv',
  cvImportedAt: 'cv',
  githubData: 'github',
  skills: 'skills',
  projects: 'projects',
};

export const stepForField = (field) => STEP_FOR_SECTION[sectionOf(field)] || 'review';

// First message for an exact field path (for inline display).
export const errorFor = (errors, field) => (errors || []).find((e) => e.field === field)?.message;

// All errors for an entry or section prefix, e.g. "certifications[2]".
export const errorsUnder = (errors, prefix) =>
  (errors || []).filter((e) => e.field === prefix || e.field.startsWith(`${prefix}.`) || e.field.startsWith(`${prefix}[`));

const LABELS = {
  personalInfo: 'Contact',
  summary: 'Summary',
  experience: 'Experience',
  education: 'Education',
  certifications: 'Certification',
  skills: 'Skills',
  projects: 'Projects',
  githubData: 'GitHub',
  manual: 'Manual',
  cv: 'From CV',
  github: 'GitHub',
  extracted: 'GitHub',
  selected: 'Selected',
  startDate: 'Start date',
  endDate: 'End date',
  title: 'Job title',
  company: 'Company',
  institution: 'Institution',
  degree: 'Degree',
  field: 'Field of study',
  issuer: 'Issuer',
  name: 'Name',
  url: 'Link',
  phone: 'Phone',
  linkedin: 'LinkedIn',
  website: 'Website',
  username: 'Username',
  description: 'Description',
  technologies: 'Technologies',
};

// "experience[1].endDate" → "Experience 2 › End date"
export const describeField = (field) =>
  String(field)
    .split('.')
    .map((part) => {
      const m = part.match(/^([^[]+)(?:\[(\d+)\])?(?:\[(\d+)\])?$/);
      if (!m) return part;
      const label = LABELS[m[1]] || m[1];
      return m[2] !== undefined ? `${label} ${+m[2] + 1}` : label;
    })
    .join(' › ');

// ── CV import helpers ────────────────────────────────────────────────────────
// "Jan 2020 - Present", "2019 – 2021", "03/2020 to 06/2022" → stored dates.
const RANGE_RE =
  /^\s*([A-Za-z]{0,9}\.?\s*\/?\s*\d{0,2}\s*[/\-.]?\s*\d{4})\s*(?:-|–|—|to|until)\s*([A-Za-z]{0,9}\.?\s*\/?\s*\d{0,2}\s*[/\-.]?\s*\d{4}|present|current|now|ongoing)\s*$/i;

const stored = (text) => {
  const r = parseDate(text);
  return r.error ? cleanText(text) : r.value;
};

export const splitDateRange = (text) => {
  if (!isStr(text)) return null;
  const m = cleanText(text).match(RANGE_RE);
  if (m) {
    const end = stored(m[2]);
    return { startDate: stored(m[1]), endDate: end === PRESENT ? '' : end, current: end === PRESENT };
  }
  const single = parseDate(text);
  if (!single.error && single.value && single.value !== PRESENT) return { startDate: single.value, endDate: '', current: false };
  return null;
};
