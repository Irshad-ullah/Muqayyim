import crypto from 'crypto';

// Module 4 — normalises the CV *source* assembled from the profile and the
// parsed CV (GET /api/generated-cvs/source). Saved CVs are validated strictly
// by validation/cvSchemas.js instead.
// Unknown fields are dropped, strings are trimmed/capped, control characters
// removed, and links restricted to http(s) so nothing like `javascript:` can
// end up in the preview or the PDF.

const MAX_ITEMS = 50;
const MAX_TECH = 40;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const text = (v, max) =>
  typeof v === 'string' ? v.replace(CONTROL_CHARS, '').trim().slice(0, max) : '';

const id = (v) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : crypto.randomBytes(6).toString('hex'));

// Accepts "https://x", "http://x" or a bare host/path like "github.com/user".
export const safeUrl = (v, max = 500) => {
  const s = text(v, max);
  if (!s) return '';
  if (/^https?:\/\/\S+$/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return ''; // other schemes / malformed rejected
  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s)) return s;
  return '';
};

const list = (v, fn, max = MAX_ITEMS) => (Array.isArray(v) ? v.slice(0, max).map(fn) : []);

const stringList = (v, maxItems, maxLen) => {
  const seen = new Set();
  return (Array.isArray(v) ? v : [])
    .map((s) => text(s, maxLen))
    .filter((s) => {
      const k = s.toLowerCase();
      if (!s || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, maxItems);
};

export const sanitizeCvData = (d = {}) => {
  const p = d.personal || {};
  return {
    personal: {
      fullName: text(p.fullName, 120),
      headline: text(p.headline, 160),
      email: text(p.email, 200),
      phone: text(p.phone, 60),
      location: text(p.location, 200),
      linkedin: safeUrl(p.linkedin),
      github: safeUrl(p.github),
      website: safeUrl(p.website),
    },
    summary: text(d.summary, 2000),
    skills: list(d.skills, (g) => ({
      id: id(g?.id),
      category: text(g?.category, 80),
      items: stringList(g?.items, 100, 80),
    }), 20).filter((g) => g.items.length),
    experience: list(d.experience, (e) => ({
      id: id(e?.id),
      title: text(e?.title, 200),
      company: text(e?.company, 200),
      location: text(e?.location, 200),
      startDate: text(e?.startDate, 40),
      endDate: text(e?.endDate, 40),
      current: !!e?.current,
      description: text(e?.description, 4000),
    })),
    education: list(d.education, (e) => ({
      id: id(e?.id),
      degree: text(e?.degree, 200),
      field: text(e?.field, 200),
      institution: text(e?.institution, 200),
      location: text(e?.location, 200),
      startDate: text(e?.startDate, 40),
      endDate: text(e?.endDate, 40),
      gpa: text(e?.gpa, 40),
      details: text(e?.details, 1000),
    })),
    projects: list(d.projects, (pr) => ({
      id: id(pr?.id),
      name: text(pr?.name, 200),
      description: text(pr?.description, 3000),
      technologies: stringList(pr?.technologies, MAX_TECH, 60),
      url: safeUrl(pr?.url),
      liveUrl: safeUrl(pr?.liveUrl),
      source: ['manual', 'github', 'cv'].includes(pr?.source) ? pr.source : 'manual',
    })),
    certifications: list(d.certifications, (c) => ({
      id: id(c?.id),
      name: text(c?.name, 200),
      issuer: text(c?.issuer, 200),
      date: text(c?.date, 40),
      url: safeUrl(c?.url),
    })),
  };
};
