import { z } from 'zod';
import { LIMITS, MAX_ENTRIES } from './profileLimits.js';
import { CV_STATUS_VALUES } from '../constants/cvStatus.js';
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
} from './rules.js';
import { EMAIL_NOT_EDITABLE, formatZodIssues } from './formatErrors.js';

// Module 3 — Profile Builder validation (FR5.1–FR5.13).
// One schema per profile section. A write validates only the sections present
// in the request, but each present section completely; the parsed (trimmed,
// normalised) output is what gets stored. Existing documents are never
// re-validated on read.

const addIssue = (ctx, message, path = []) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
const isStr = (v) => typeof v === 'string';

// ── Field builders ───────────────────────────────────────────────────────────
export const text = (label, max, { required = false, multiline = false } = {}) =>
  z.preprocess(
    (v) => (v === undefined || v === null ? '' : cleanText(v, { multiline })),
    z
      .string({ invalid_type_error: `${label} must be text` })
      .max(max, `${label} must be at most ${max} characters`)
      .refine((s) => !required || s.length > 0, `${label} is required`),
  );

// Wraps a rules.js checker ({ value } | { error }) as a Zod field.
export const ruled = (check) =>
  z.any().transform((v, ctx) => {
    const r = check(v);
    if (r.error) {
      addIssue(ctx, r.error);
      return z.NEVER;
    }
    return r.value;
  });

const date = ruled((v) => parseDate(v));
const url = ruled(normalizeUrl);
const projectUrl = ruled((v) => normalizeProjectUrl(v));
const githubRepoUrl = ruled((v) => normalizeProjectUrl(v, { githubOnly: true }));

const bool = (label) =>
  z.preprocess((v) => (v === undefined || v === null ? false : v), z.boolean({ invalid_type_error: `${label} must be true or false` }));

// Sub-document ids sent back by the client are kept when well-formed.
const objectId = z.preprocess((v) => (isStr(v) && /^[a-f\d]{24}$/i.test(v) ? v : undefined), z.string().optional());

const orEmpty = (fallback) => (v) => (v === undefined || v === null ? fallback : v);

export const list = (schema, max, label) =>
  z.preprocess(
    orEmpty([]),
    z
      .array(schema, { invalid_type_error: `${label} must be a list` })
      .max(max, `You can add at most ${max} ${label.toLowerCase()}`),
  );

const object = (shape, label) => z.object(shape, { invalid_type_error: `${label} must be an object` });

const dateTime = (label) =>
  z.any().transform((v, ctx) => {
    if (v === undefined || v === null || v === '') return null;
    const d = v instanceof Date ? v : isStr(v) ? new Date(v) : null;
    if (!d || Number.isNaN(d.getTime())) {
      addIssue(ctx, `${label} must be a date and time`);
      return z.NEVER;
    }
    return d;
  });

// Skill-like string lists: entries trimmed, empties dropped, over-long ones
// rejected (path = index in the list as sent), case-insensitive de-duplication.
export const stringList = (label, maxItems = Infinity) =>
  z.any().transform((v, ctx) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      addIssue(ctx, `${label} must be a list`);
      return z.NEVER;
    }
    const out = [];
    v.forEach((item, i) => {
      const r = checkSkillName(item);
      if (r.error) addIssue(ctx, r.error, [i]);
      else if (r.value) out.push(r.value);
    });
    const [unique] = dedupeAcross([out]);
    if (unique.length > maxItems) addIssue(ctx, `You can add at most ${maxItems} ${label.toLowerCase()}`);
    return unique;
  });

const L = LIMITS;
const technologies = stringList('Technologies', L.technologiesMax);

// ── Entry factories (shared with the CV-generator snapshot schema) ───────────
// FR5.3: title, company and start required; end required unless current;
// start ≤ end; nothing after the current month. "Present" → current=true.
export const experienceEntry = (extra = {}) =>
  object(
    {
      title: text('Job title', L.titleMax, { required: true }),
      company: text('Company', L.orgMax, { required: true }),
      location: text('Location', L.locationMax),
      startDate: date,
      endDate: date,
      current: bool('Current'),
      description: text('Description', L.descriptionMax, { multiline: true }),
      ...extra,
    },
    'Experience entry',
  )
    .superRefine((e, ctx) => {
      const startOk = isStr(e.startDate) && e.startDate && e.startDate !== PRESENT;
      if (isStr(e.startDate)) {
        if (!e.startDate) addIssue(ctx, 'Start date is required', ['startDate']);
        else if (e.startDate === PRESENT) addIssue(ctx, 'Start date must be a month or year, not "Present"', ['startDate']);
        else if (isFutureDate(e.startDate)) addIssue(ctx, 'Start date cannot be in the future', ['startDate']);
      }
      const current = e.current === true || e.endDate === PRESENT;
      if (isStr(e.endDate) && !current) {
        if (!e.endDate) addIssue(ctx, 'End date is required unless this is your current role', ['endDate']);
        else if (isFutureDate(e.endDate)) addIssue(ctx, 'End date cannot be in the future', ['endDate']);
        else if (startOk && !isFutureDate(e.startDate) && compareDates(e.startDate, e.endDate) > 0) {
          addIssue(ctx, 'End date must be after the start date', ['endDate']);
        }
      }
    })
    .transform((e) => {
      const current = e.current === true || e.endDate === PRESENT;
      return { ...e, current, endDate: current ? '' : e.endDate };
    });

// FR5.4: degree and institution required; start ≤ end. An end date may be up
// to 10 years ahead (expected graduation); "Present" means ongoing → ''.
export const educationEntry = (extra = {}) =>
  object(
    {
      institution: text('Institution', L.orgMax, { required: true }),
      degree: text('Degree', L.titleMax, { required: true }),
      field: text('Field of study', L.titleMax),
      startDate: date,
      endDate: date,
      gpa: text('GPA', L.gpaMax),
      ...extra,
    },
    'Education entry',
  )
    .superRefine((e, ctx) => {
      if (e.startDate === PRESENT) addIssue(ctx, 'Start date must be a month or year, not "Present"', ['startDate']);
      const bothSet = isStr(e.startDate) && isStr(e.endDate) && e.startDate && e.endDate;
      if (bothSet && e.startDate !== PRESENT && e.endDate !== PRESENT && compareDates(e.startDate, e.endDate) > 0) {
        addIssue(ctx, 'End date must be after the start date', ['endDate']);
      }
    })
    .transform((e) => ({ ...e, endDate: e.endDate === PRESENT ? '' : e.endDate }));

// FR5.6: name and issuer required; link must be http(s).
export const certificationEntry = (extra = {}) =>
  object(
    {
      name: text('Certification name', L.titleMax, { required: true }),
      issuer: text('Issuer', L.orgMax, { required: true }),
      date,
      url,
      ...extra,
    },
    'Certification',
  ).superRefine((c, ctx) => {
    if (c.date === PRESENT) addIssue(ctx, 'Use the month or year you earned it', ['date']);
    else if (isStr(c.date) && c.date && isFutureDate(c.date)) addIssue(ctx, 'Date cannot be in the future', ['date']);
  });

// FR5.7: title (name) required; description ≤ 1000; github.com links must be
// a repository URL, other links must be http(s).
export const projectEntry = (extra = {}) =>
  object(
    {
      name: text('Project name', L.titleMax, { required: true }),
      description: text('Description', L.descriptionMax, { multiline: true }),
      url: projectUrl,
      technologies,
      ...extra,
    },
    'Project',
  );

const source = (values) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? 'manual' : v),
    z.enum(values, { errorMap: () => ({ message: `Source must be one of: ${values.join(', ')}` }) }),
  );

// ── Section schemas ──────────────────────────────────────────────────────────
// FR5.1: email is not part of the profile and cannot be changed here.
const personalInfo = z.preprocess(
  orEmpty({}),
  object(
    {
      phone: ruled(checkPhone),
      location: text('Location', L.locationMax),
      website: url,
      linkedin: url,
      github: url,
    },
    'Personal info',
  ).strict(),
);

// FR5.5: ≤100 skills in total after case-insensitive de-duplication across
// sources (manual first, so the user's own spelling wins).
const skills = z.preprocess(
  orEmpty({}),
  object({ manual: stringList('Skills'), cv: stringList('Skills'), extracted: stringList('Skills') }, 'Skills')
    .superRefine((s, ctx) => {
      if (![s.manual, s.cv, s.extracted].every(Array.isArray)) return;
      const total = dedupeAcross([s.manual, s.cv, s.extracted]).reduce((n, l) => n + l.length, 0);
      if (total > L.skill.maxTotal) addIssue(ctx, `You can have at most ${L.skill.maxTotal} skills (you have ${total})`);
    })
    .transform((s) => {
      const [manual, cv, extracted] = dedupeAcross([s.manual, s.cv, s.extracted]);
      return { manual, cv, extracted };
    }),
);

const projects = z.preprocess(
  orEmpty({}),
  object(
    {
      manual: list(projectEntry({ _id: objectId }), MAX_ENTRIES.projects, 'Projects'),
      github: list(
        object(
          {
            _id: objectId,
            repoId: z.preprocess(
              (v) => (v === null ? undefined : v),
              z.number({ invalid_type_error: 'Repository id must be a number' }).int().optional(),
            ),
            name: text('Repository name', L.titleMax, { required: true }),
            description: text('Description', L.descriptionMax, { multiline: true }),
            url: githubRepoUrl,
            languages: stringList('Languages', L.technologiesMax),
            topics: stringList('Topics', L.technologiesMax),
            stars: z.preprocess(orEmpty(0), z.number({ invalid_type_error: 'Stars must be a number' }).int().min(0)),
          },
          'Repository',
        ),
        MAX_ENTRIES.projects,
        'GitHub projects',
      ),
      cv: list(
        object(
          {
            _id: objectId,
            name: text('Project name', L.titleMax, { required: true }),
            description: text('Description', L.descriptionMax, { multiline: true }),
            technologies,
          },
          'Project',
        ),
        MAX_ENTRIES.projects,
        'CV projects',
      ),
      selected: list(
        projectEntry({ _id: objectId, source: source(['manual', 'github', 'cv']) }),
        MAX_ENTRIES.projects,
        'Selected projects',
      ),
    },
    'Projects',
  ),
);

// FR5.8: GitHub username rules; repos are the server-fetched list echoed back.
const githubData = z.preprocess(
  orEmpty({}),
  object(
    {
      username: ruled((v) => checkGithubUsername(v)),
      repos: list(z.record(z.any(), { invalid_type_error: 'Repository must be an object' }), MAX_ENTRIES.githubRepos, 'Repositories'),
      extractedSkills: stringList('Extracted skills', L.skill.maxTotal),
      lastSynced: dateTime('Last synced'),
    },
    'GitHub data',
  ),
);

const cvData = object(
  {
    fileName: text('File name', 255),
    uploadDate: dateTime('Upload date'),
    parsingStatus: z.preprocess(
      orEmpty(''),
      z.enum(['', ...CV_STATUS_VALUES], { errorMap: () => ({ message: 'Unknown CV status' }) }),
    ),
    parsedData: z.any().transform((v, ctx) => {
      if (v === undefined || v === null) return {};
      if (typeof v !== 'object' || Array.isArray(v)) {
        addIssue(ctx, 'Parsed data must be an object');
        return z.NEVER;
      }
      if (Buffer.byteLength(JSON.stringify(v)) > L.cv.snapshotMaxBytes) {
        addIssue(ctx, `Parsed data must be at most ${L.cv.snapshotMaxBytes / 1024} KB`);
        return z.NEVER;
      }
      return v;
    }),
  },
  'CV data',
).nullable();

export const PROFILE_SECTIONS = {
  personalInfo,
  summary: text('Summary', L.summaryMax, { multiline: true }),
  experience: list(experienceEntry({ _id: objectId, source: source(['manual', 'cv']) }), MAX_ENTRIES.experience, 'Experience entries'),
  education: list(educationEntry({ _id: objectId, source: source(['manual', 'cv']) }), MAX_ENTRIES.education, 'Education entries'),
  skills,
  certifications: list(certificationEntry({ _id: objectId }), MAX_ENTRIES.certifications, 'Certifications'),
  projects,
  githubData,
  cvImportedAt: dateTime('CV import time'),
  cvData,
};

export const ALLOWED_FIELDS = Object.keys(PROFILE_SECTIONS);

// Read-only fields the client gets back from GET /api/profile; ignored on write.
const READ_ONLY_FIELDS = new Set(['_id', '__v', 'userId', 'createdAt', 'updatedAt']);

export const validateSection = (key, value) => {
  const result = PROFILE_SECTIONS[key].safeParse(value);
  return result.success
    ? { data: result.data, errors: [] }
    : { data: undefined, errors: formatZodIssues(result.error.issues, [key]) };
};

// Partial update: validates only the sections present in `body`.
export const validateProfileUpdate = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { data: {}, errors: [{ field: 'body', message: 'Request body must be a JSON object' }] };
  }
  const errors = [];
  const data = {};
  for (const key of Object.keys(body)) {
    if (READ_ONLY_FIELDS.has(key) || key in PROFILE_SECTIONS) continue;
    if (key === 'email') errors.push({ field: 'email', message: EMAIL_NOT_EDITABLE });
    else if (key === 'name') errors.push({ field: 'name', message: 'Your name is changed in Account settings, not in the profile.' });
    else errors.push({ field: key, message: 'Unknown field' });
  }
  for (const key of ALLOWED_FIELDS) {
    if (body[key] === undefined) continue;
    const r = validateSection(key, body[key]);
    if (r.errors.length) errors.push(...r.errors);
    else data[key] = r.data;
  }
  return { data, errors };
};
