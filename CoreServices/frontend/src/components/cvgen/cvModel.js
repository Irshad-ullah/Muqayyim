// Module 4 — shared CV model: section metadata, design options and pure
// formatting helpers used by the editor, the HTML preview and the PDF export.

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

// Mirrors the server-side validateCvData rules so problems show before saving.
export const validateCv = (data) => {
  const errors = [];
  if (!data.personal?.fullName?.trim()) errors.push('Full name is required.');
  [['linkedin', 'LinkedIn'], ['github', 'GitHub'], ['website', 'Website']].forEach(([k, label]) => {
    if (!isValidUrl(data.personal?.[k])) errors.push(`${label} link is not a valid URL.`);
  });
  (data.projects || []).forEach((p, i) => {
    if (!isValidUrl(p.url) || !isValidUrl(p.liveUrl)) errors.push(`Project #${i + 1} has an invalid URL.`);
  });
  (data.certifications || []).forEach((c, i) => {
    if (!isValidUrl(c.url)) errors.push(`Certification #${i + 1} has an invalid URL.`);
  });
  const hasContent = ['summary', 'skills', 'experience', 'education', 'projects'].some((k) =>
    sectionHasContent(k, data),
  );
  if (!hasContent) {
    errors.push('Add at least one of: summary, skills, experience, education or projects.');
  }
  (data.experience || []).forEach((e, i) => {
    if (!e.title?.trim() && !e.company?.trim()) errors.push(`Experience #${i + 1} needs a job title or company.`);
  });
  (data.education || []).forEach((e, i) => {
    if (!e.institution?.trim() && !e.degree?.trim()) errors.push(`Education #${i + 1} needs a degree or institution.`);
  });
  (data.projects || []).forEach((p, i) => {
    if (!p.name?.trim()) errors.push(`Project #${i + 1} needs a name.`);
  });
  (data.certifications || []).forEach((c, i) => {
    if (!c.name?.trim()) errors.push(`Certification #${i + 1} needs a name.`);
  });
  return errors;
};

export const fileNameFor = (title) =>
  `${(title || 'CV').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'CV'}.pdf`;
