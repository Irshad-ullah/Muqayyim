import { PROFILE_LIMITS as L } from '../constants/profileLimits.js';
import { checkSkillName, normalizeUrl } from './profileRules.js';
import {
  checkCertification,
  checkEducation,
  checkExperience,
  checkProject,
  makeCollector,
  splitDateRange,
} from './validateProfile.js';

// Parsed CV (AIServices) ⇄ profile. Pure functions shared by the CV review
// screen, the Profile Builder's CV-import step and tests.

// ── Review screen (PUT /api/cv/verify) ───────────────────────────────────────
// Same rules the server applies on verify (and the profile on import); paths
// match the server's minus the "verified_data." prefix.
export const validateParsedCv = (data = {}) => {
  const c = makeCollector();
  const list = (key, max, label) => c.list(key, data[key], max, label) || [];

  const skills = list('skills', L.skill.maxTotal, 'Skills');
  skills.forEach((s, i) => {
    const r = checkSkillName(s?.name ?? s);
    if (r.error) c.add(`skills[${i}].name`, r.error);
    else if (!r.value) c.add(`skills[${i}].name`, 'Skill name is required');
  });
  list('experience', L.maxEntries.experience, 'Experience entries').forEach((e, i) => checkExperience(c, `experience[${i}]`, e));
  list('education', L.maxEntries.education, 'Education entries').forEach((e, i) => checkEducation(c, `education[${i}]`, e));
  list('certifications', L.maxEntries.certifications, 'Certifications').forEach((x, i) =>
    checkCertification(c, `certifications[${i}]`, x),
  );
  list('projects', L.maxEntries.projects, 'Projects').forEach((p, i) => {
    checkProject(c, `projects[${i}]`, { ...p, url: p?.githubUrl }, { githubOnly: true });
    c.rule(`projects[${i}].liveUrl`, normalizeUrl(p?.liveUrl));
    c.strings(`projects[${i}].technologies`, p?.technologies, 'Technologies', L.technologiesMax);
  });
  // checkProject reports the GitHub link under ".url"; the parsed field is githubUrl.
  return c.errors.map((e) => ({ ...e, field: e.field.replace(/^(projects\[\d+\])\.url$/, '$1.githubUrl') }));
};

// Field names users see in "Please add …" hints.
const HINTS = {
  title: 'a job title',
  company: 'the company',
  startDate: 'a start date',
  endDate: 'an end date (or tick "current")',
  degree: 'the degree',
  institution: 'the institution',
  name: 'a name',
  issuer: 'the issuer',
  date: 'the date',
  url: 'a valid link',
  githubUrl: 'a GitHub repository link',
  liveUrl: 'a valid link',
};
export const reviewHint = (field) => `Please add ${HINTS[field] || 'this'}`;

// ── Profile Builder import (Step 2) ──────────────────────────────────────────
const pick = (items, selected) => (items || []).filter((_, i) => selected?.[i]);

// Older parses only have `duration` / `year`; newer ones carry real dates.
const experienceDates = (e) => {
  if (e.startDate || e.current) return { startDate: e.startDate || '', endDate: e.current ? '' : e.endDate || '', current: !!e.current, fromText: false };
  const range = splitDateRange(e.duration);
  return range ? { ...range, fromText: false } : { startDate: '', endDate: '', current: false, fromText: !!e.duration };
};

const educationDates = (e) => {
  if (e.startDate || e.endDate) return { startDate: e.startDate || '', endDate: e.endDate || '' };
  const range = splitDateRange(e.year);
  if (!range) return { startDate: '', endDate: '' };
  return range.endDate || range.current ? { startDate: range.startDate, endDate: range.endDate } : { startDate: '', endDate: range.startDate };
};

export const mapExperience = (e) => {
  const dates = experienceDates(e);
  return {
    title: e.title || '',
    company: e.company || '',
    location: e.location || '',
    // An unparseable duration stays visible in the description to fix by hand.
    description: e.description || (dates.fromText ? e.duration : ''),
    startDate: dates.startDate,
    endDate: dates.endDate,
    current: dates.current,
    source: 'cv',
  };
};

export const mapEducation = (e) => ({
  institution: e.institution || '',
  degree: e.degree || '',
  field: e.field || '',
  ...educationDates(e),
  gpa: e.gpa || '',
  source: 'cv',
});

export const mapCertification = (c) => ({ name: c.name || '', issuer: c.issuer || '', date: c.date || '', url: c.url || '' });

export const mapProject = (p) => ({
  name: p.name || '',
  description: p.description || '',
  url: p.githubUrl || p.liveUrl || p.url || '',
  technologies: p.technologies || [],
});

const key = (...parts) => parts.map((p) => String(p || '').trim().toLowerCase()).join('|');

// Merges the selected parsed items into the profile: earlier CV imports are
// replaced, manual entries kept (exact duplicates of a manual entry skipped).
export const mapParsedCvToProfile = (parsedCv, selections, profile) => {
  const manualExp = (profile.experience || []).filter((e) => e.source !== 'cv');
  const manualEdu = (profile.education || []).filter((e) => e.source !== 'cv');
  const expKeys = new Set(manualExp.map((e) => key(e.title, e.company)));
  const eduKeys = new Set(manualEdu.map((e) => key(e.institution, e.degree)));
  const certKeys = new Set((profile.certifications || []).map((c) => key(c.name)));

  const newCerts = pick(parsedCv.certifications, selections.certifications)
    .map(mapCertification)
    .filter((c) => c.name && !certKeys.has(key(c.name)));

  return {
    experience: [
      ...manualExp,
      ...pick(parsedCv.experience, selections.experience).map(mapExperience).filter((e) => !expKeys.has(key(e.title, e.company))),
    ],
    education: [
      ...manualEdu,
      ...pick(parsedCv.education, selections.education).map(mapEducation).filter((e) => !eduKeys.has(key(e.institution, e.degree))),
    ],
    certifications: [...(profile.certifications || []), ...newCerts],
    skills: { ...profile.skills, cv: pick(parsedCv.skills, selections.skills).map((s) => s.name) },
    projects: { ...profile.projects, cv: pick(parsedCv.projects, selections.projects).map(mapProject) },
  };
};
