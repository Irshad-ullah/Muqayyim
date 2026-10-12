import crypto from 'crypto';
import { z } from 'zod';
import { CV_LIMITS, LIMITS, MAX_ENTRIES } from './profileLimits.js';
import { checkPhone, cleanText, dedupeAcross, normalizeUrl } from './rules.js';
import { formatZodIssues } from './formatErrors.js';
import {
  certificationEntry,
  educationEntry,
  experienceEntry,
  list,
  projectEntry,
  ruled,
  stringList,
  text,
} from './profileSchemas.js';

// Module 4 — CV generator payload validation (FR6.1–FR6.8). The snapshot's
// entries reuse the profile entry schemas, so a saved CV follows the same
// field rules as the profile it was built from.

const addIssue = (ctx, message, path = []) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const L = LIMITS;

const itemId = z.any().transform((v) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : crypto.randomBytes(6).toString('hex')));

const choice = (values, fallback, label) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? fallback : v),
    z.enum(values, { errorMap: () => ({ message: `${label} must be one of: ${values.join(', ')}` }) }),
  );

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const email = ruled((v) => {
  if (v === undefined || v === null) return { value: '' };
  if (typeof v !== 'string') return { error: 'Email must be text' };
  const s = cleanText(v);
  if (!s) return { value: '' };
  if (s.length > L.emailMax || !EMAIL.test(s)) return { error: 'Must be a valid email address' };
  return { value: s };
});

// Section keys: only known ones, each at most once (path = index as sent).
const sectionList = (label) =>
  z.preprocess(
    (v) => (v === undefined || v === null ? [] : v),
    z.array(z.string({ invalid_type_error: 'Section must be text' }), { invalid_type_error: `${label} must be a list` }).superRefine(
      (keys, ctx) => {
        const seen = new Set();
        keys.forEach((k, i) => {
          if (!CV_LIMITS.sectionKeys.includes(k)) addIssue(ctx, `Unknown section "${String(k).slice(0, 40)}"`, [i]);
          else if (seen.has(k)) addIssue(ctx, `Section "${k}" is listed more than once`, [i]);
          seen.add(k);
        });
      },
    ),
  );

export const cvSettingsSchema = z.preprocess(
  (v) => (v === undefined || v === null ? {} : v),
  z.object(
    {
      // Named professional palette; older keys map to their nearest colour.
      accentColor: z.preprocess(
        (v) => (v === undefined || v === null || v === '' ? 'slate' : CV_LIMITS.legacyAccents[v] || v),
        z.enum(CV_LIMITS.accentColors, {
          errorMap: () => ({ message: `Accent colour must be one of: ${CV_LIMITS.accentColors.join(', ')}` }),
        }),
      ),
      fontFamily: choice(CV_LIMITS.fontFamilies, 'sans', 'Font family'),
      fontSize: choice(CV_LIMITS.fontSizes, 'medium', 'Font size'),
      groupSkills: z.preprocess(
        (v) => (v === undefined || v === null ? true : v),
        z.boolean({ invalid_type_error: 'Group skills must be true or false' }),
      ),
      // Every section stays present exactly once: the user's order first.
      sectionOrder: sectionList('Section order').transform((order) => [
        ...order,
        ...CV_LIMITS.sectionKeys.filter((k) => !order.includes(k)),
      ]),
      hiddenSections: sectionList('Hidden sections'),
    },
    { invalid_type_error: 'Settings must be an object' },
  ),
);

const personal = z.preprocess(
  (v) => (v === undefined || v === null ? {} : v),
  z.object(
    {
      // Presence of the name is checked by the completeness rule (FR6.8).
      fullName: text('Full name', L.name.max).refine(
        (s) => !s || s.length >= L.name.min,
        `Full name must be at least ${L.name.min} characters`,
      ),
      headline: text('Headline', CV_LIMITS.headlineMax),
      email,
      phone: ruled(checkPhone),
      location: text('Location', L.locationMax),
      linkedin: ruled(normalizeUrl),
      github: ruled(normalizeUrl),
      website: ruled(normalizeUrl),
    },
    { invalid_type_error: 'Personal details must be an object' },
  ),
);

const skillGroups = list(
  z.object(
    { id: itemId, category: text('Category', CV_LIMITS.skillCategoryMax), items: stringList('Skills') },
    { invalid_type_error: 'Skill group must be an object' },
  ),
  CV_LIMITS.skillGroupsMax,
  'Skill groups',
)
  .superRefine((groups, ctx) => {
    if (!groups.every((g) => Array.isArray(g?.items))) return;
    const total = dedupeAcross(groups.map((g) => g.items)).reduce((n, l) => n + l.length, 0);
    if (total > L.skill.maxTotal) addIssue(ctx, `You can have at most ${L.skill.maxTotal} skills (you have ${total})`);
  })
  .transform((groups) => {
    const items = dedupeAcross(groups.map((g) => g.items));
    return groups.map((g, i) => ({ ...g, items: items[i] })).filter((g) => g.items.length);
  });

export const cvDataSchema = z.object(
  {
    personal,
    summary: text('Summary', L.summaryMax, { multiline: true }),
    skills: skillGroups,
    experience: list(experienceEntry({ id: itemId }), MAX_ENTRIES.experience, 'Experience entries'),
    education: list(
      educationEntry({
        id: itemId,
        location: text('Location', L.locationMax),
        details: text('Details', L.descriptionMax, { multiline: true }),
      }),
      MAX_ENTRIES.education,
      'Education entries',
    ),
    projects: list(
      projectEntry({
        id: itemId,
        liveUrl: ruled(normalizeUrl),
        source: choice(['manual', 'github', 'cv'], 'manual', 'Source'),
      }),
      MAX_ENTRIES.projects,
      'Projects',
    ),
    certifications: list(certificationEntry({ id: itemId }), MAX_ENTRIES.certifications, 'Certifications'),
  },
  { invalid_type_error: 'CV content must be an object' },
);

const payloadSchema = z.object({
  title: text('Title', CV_LIMITS.titleMax),
  template: choice(CV_LIMITS.templates, 'classic', 'Template'),
  settings: cvSettingsSchema,
  data: cvDataSchema,
});

// FR6.8: a CV needs a name and at least one of experience, education,
// projects or skills. Checked on the raw payload, before field validation.
export const CONTENT_SECTIONS = ['experience', 'education', 'projects', 'skills'];

export const missingForGeneration = (data) => {
  const d = isObj(data) ? data : {};
  const missing = [];
  const name = typeof d.personal?.fullName === 'string' ? cleanText(d.personal.fullName) : '';
  if (!name) missing.push('name');
  const nonEmpty = (k) => Array.isArray(d[k]) && d[k].length > 0;
  const hasSkills =
    Array.isArray(d.skills) &&
    d.skills.some((g) => Array.isArray(g?.items) && g.items.some((s) => typeof s === 'string' && s.trim()));
  if (!(nonEmpty('experience') || nonEmpty('education') || nonEmpty('projects') || hasSkills)) {
    missing.push(...CONTENT_SECTIONS);
  }
  return missing;
};

export const incompleteMessage = (missing) => {
  const parts = [];
  if (missing.includes('name')) parts.push('your name');
  if (missing.includes('experience')) parts.push('at least one of: experience, education, projects or skills');
  return `Add ${parts.join(' and ')} before generating a CV.`;
};

// Returns { value } | { errors } | { missing }.
export const validateCvPayload = (body) => {
  if (!isObj(body)) return { errors: [{ field: 'body', message: 'Request body must be a JSON object' }] };
  if (!isObj(body.data)) return { errors: [{ field: 'data', message: 'CV content is required' }] };
  if (Buffer.byteLength(JSON.stringify(body.data)) > CV_LIMITS.snapshotMaxBytes) {
    return { errors: [{ field: 'data', message: `CV content must be at most ${CV_LIMITS.snapshotMaxBytes / 1024} KB` }] };
  }
  const missing = missingForGeneration(body.data);
  if (missing.length) return { missing };
  const result = payloadSchema.safeParse(body);
  if (!result.success) return { errors: formatZodIssues(result.error.issues) };
  return { value: result.data };
};
