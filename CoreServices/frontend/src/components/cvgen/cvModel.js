// Module 4 — shared CV model: section metadata, design options and pure
// formatting helpers used by the editor, the HTML preview and the PDF export.

import { PROFILE_LIMITS as L } from '../../constants/profileLimits.js';
import { checkPhone, cleanText, dedupeAcross, normalizeUrl } from '../../validation/profileRules.js';
import {
  checkCertification,
  checkEducation,
  checkExperience,
  checkProject,
  describeField,
  makeCollector,
} from '../../validation/validateProfile.js';

export const SECTION_LABELS = {
  summary: 'Professional Summary',
  skills: 'Skills',
  experience: 'Work Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
};

export const SECTION_KEYS = Object.keys(SECTION_LABELS);

export const TEMPLATES = [
  { id: 'classic', name: 'Classic', description: 'Centered header, ruled section headings' },
  { id: 'modern', name: 'Modern', description: 'Left-aligned header with accent headings' },
  { id: 'compact', name: 'Compact', description: 'Tighter spacing to fit more on a page' },
];

// Conservative, professional heading colours only (dark, print-safe, high contrast).
export const ACCENT_COLORS = {
  slate: '#334155',
  black: '#111111',
  navy: '#1e3a5f',
  teal: '#134e4a',
  burgundy: '#7f1d1d',
};

export const ACCENT_LABELS = {
  slate: 'Charcoal',
  black: 'Black',
  navy: 'Navy',
  teal: 'Dark teal',
  burgundy: 'Burgundy',
};

// Colours offered by earlier versions → nearest professional replacement,
// so CVs saved before the palette change keep a sensible colour.
export const LEGACY_ACCENTS = { blue: 'navy', indigo: 'navy', green: 'teal' };

export const resolveAccent = (key) => {
  const k = LEGACY_ACCENTS[key] || key;
  return ACCENT_COLORS[k] ? k : 'slate';
};

export const FONT_SCALES = { small: 0.92, medium: 1, large: 1.08 };

export const DEFAULT_SETTINGS = {
  accentColor: 'slate',
  fontFamily: 'sans',
  fontSize: 'medium',
  groupSkills: true,
  sectionOrder: SECTION_KEYS,
  hiddenSections: [],
};

export const newItemId = () => Math.random().toString(36).slice(2, 14);

export const EMPTY_ITEMS = {
  experience: () => ({
    id: newItemId(), title: '', company: '', location: '', startDate: '', endDate: '', current: false, description: '',
  }),
  education: () => ({
    id: newItemId(), degree: '', field: '', institution: '', location: '', startDate: '', endDate: '', gpa: '', details: '',
  }),
  projects: () => ({
    id: newItemId(), name: '', description: '', technologies: [], url: '', liveUrl: '', source: 'manual',
  }),
  certifications: () => ({ id: newItemId(), name: '', issuer: '', date: '', url: '' }),
  skills: () => ({ id: newItemId(), category: '', items: [] }),
};

// ── Formatting ───────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2024-06" → "Jun 2024"; anything else is shown exactly as the user wrote it.
export const formatDate = (value) => {
  const v = (value || '').trim();
  const m = v.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${MONTHS[+m[2] - 1]} ${m[1]}`;
  return v;
};

export const formatRange = (start, end, current) => {
  const s = formatDate(start);
  const e = current ? 'Present' : formatDate(end);
  if (s && e) return `${s} – ${e}`;
  return s || e || '';
};

// Splits a free-text description into bullet points when it is written as a
// list (one item per line, optionally prefixed with -, *, •). A single
// paragraph stays a paragraph.
export const toBullets = (text) => {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { bullets: [], paragraph: '' };
  const bulletLike = lines.filter((l) => /^[-*•–]\s+/.test(l)).length;
  if (lines.length === 1 && !bulletLike) return { bullets: [], paragraph: lines[0] };
  return { bullets: lines.map((l) => l.replace(/^[-*•–]\s+/, '')), paragraph: '' };
};

export const displayUrl = (url) => (url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
export const hrefUrl = (url) => {
  const u = (url || '').trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
};

// ── Content helpers ──────────────────────────────────────────────────────────
export const sectionHasContent = (key, data) => {
  switch (key) {
    case 'summary':
      return !!data.summary?.trim();
    case 'skills':
      return data.skills?.some((g) => g.items?.length);
    default:
      return (data[key] || []).length > 0;
  }
};

export const visibleSections = (data, settings) =>
  (settings.sectionOrder || SECTION_KEYS).filter(
    (k) => !(settings.hiddenSections || []).includes(k) && sectionHasContent(k, data),
  );

// Same acceptance rule as the server's safeUrl: http(s) or a bare domain/path.
export const isValidUrl = (url) => {
  const s = (url || '').trim();
  if (!s) return true;
  if (/^https?:\/\/\S+$/i.test(s)) return true;
  return /^[\w.-]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s);
};

// ── Validation (mirrors backend/validation/cvSchemas.js) ─────────────────────
// FR6.8: a CV needs a name and at least one of these sections.
export const CONTENT_SECTIONS = ['experience', 'education', 'projects', 'skills'];

export const missingForGeneration = (data = {}) => {
  const missing = [];
  if (!data.personal?.fullName?.trim()) missing.push('name');
  const has = (k) => (data[k] || []).length > 0;
  const hasSkills = (data.skills || []).some((g) => (g.items || []).some((s) => s?.trim?.()));
  if (!(has('experience') || has('education') || has('projects') || hasSkills)) missing.push(...CONTENT_SECTIONS);
  return missing;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Field rules on the CV content; paths are relative to `data`
// (the server reports the same paths prefixed with "data.").
export const validateCvFields = (data = {}) => {
  const c = makeCollector();
  const pi = data.personal || {};
  c.text('personal.fullName', pi.fullName, 'Full name', L.name.max);
  const name = cleanText(pi.fullName || '');
  if (name && name.length < L.name.min) c.add('personal.fullName', `Full name must be at least ${L.name.min} characters`);
  c.text('personal.headline', pi.headline, 'Headline', L.cv.headlineMax);
  const email = cleanText(pi.email || '');
  if (email && (email.length > L.emailMax || !EMAIL.test(email))) c.add('personal.email', 'Must be a valid email address');
  c.rule('personal.phone', checkPhone(pi.phone));
  c.text('personal.location', pi.location, 'Location', L.locationMax);
  ['linkedin', 'github', 'website'].forEach((k) => c.rule(`personal.${k}`, normalizeUrl(pi[k])));
  c.text('summary', data.summary, 'Summary', L.summaryMax, { multiline: true });

  const groups = c.list('skills', data.skills, L.cv.skillGroupsMax, 'Skill groups') || [];
  const items = groups.map((g, i) => {
    c.text(`skills[${i}].category`, g?.category, 'Category', L.cv.skillCategoryMax);
    return c.strings(`skills[${i}].items`, g?.items, 'Skills') || [];
  });
  const total = dedupeAcross(items).reduce((n, l) => n + l.length, 0);
  if (total > L.skill.maxTotal) c.add('skills', `You can have at most ${L.skill.maxTotal} skills (you have ${total})`);

  c.list('experience', data.experience, L.maxEntries.experience, 'Experience entries')?.forEach((e, i) =>
    checkExperience(c, `experience[${i}]`, e),
  );
  c.list('education', data.education, L.maxEntries.education, 'Education entries')?.forEach((e, i) => {
    checkEducation(c, `education[${i}]`, e);
    c.text(`education[${i}].location`, e?.location, 'Location', L.locationMax);
    c.text(`education[${i}].details`, e?.details, 'Details', L.descriptionMax, { multiline: true });
  });
  c.list('projects', data.projects, L.maxEntries.projects, 'Projects')?.forEach((p, i) => {
    checkProject(c, `projects[${i}]`, p);
    c.rule(`projects[${i}].liveUrl`, normalizeUrl(p?.liveUrl));
    c.strings(`projects[${i}].technologies`, p?.technologies, 'Technologies', L.technologiesMax);
  });
  c.list('certifications', data.certifications, L.maxEntries.certifications, 'Certifications')?.forEach((x, i) =>
    checkCertification(c, `certifications[${i}]`, x),
  );
  return c.errors;
};

// Readable messages ("Experience 2 › End date: …") for the page's error list.
export const describeCvError = ({ field, message }) =>
  `${describeField(String(field).replace(/^data\./, ''))}: ${message}`;

export const validateCv = (data) => validateCvFields(data).map(describeCvError);

export const fileNameFor = (title) =>
  `${(title || 'CV').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'CV'}.pdf`;
