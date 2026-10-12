import crypto from 'crypto';
import User from '../models/User.js';
import Profile from '../models/Profile.js';
import { getLatestParsedCv } from './aiServiceClient.js';
import { CV_STATUS } from '../constants/cvStatus.js';
import { SECTION_KEYS } from '../models/GeneratedCv.js';

// Module 4 — CV source adapter.
// Builds the normalized CV structure consumed by every CV template from the
// data Modules 1–3 already store. It only re-arranges existing facts; it never
// generates or invents content.
//
// Precedence per section:
//   1. Profile Builder data (Module 3) — includes CV items the user reviewed
//      and imported, manual entries and selected GitHub projects.
//   2. Parsed CV record (Module 2, fetched from AIServices over internal HTTP)
//      — used only for sections the profile lacks. If AIServices is down the
//      CV is built from profile data alone.

const newId = () => crypto.randomBytes(6).toString('hex');
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

// ── Skill categorisation ─────────────────────────────────────────────────────
// Deterministic keyword lookup; anything unknown stays under "Other".
const SKILL_CATEGORIES = [
  {
    category: 'Programming Languages',
    keywords: [
      'javascript', 'typescript', 'python', 'java', 'c', 'c++', 'c#', 'go', 'golang',
      'rust', 'ruby', 'php', 'kotlin', 'swift', 'scala', 'r', 'dart', 'perl', 'matlab',
      'bash', 'shell', 'powershell', 'sql', 'html', 'css', 'html5', 'css3', 'objective-c',
      'lua', 'haskell', 'elixir', 'assembly', 'solidity', 'scss', 'sass', 'vue', 'jupyter notebook',
    ],
  },
  {
    category: 'Frameworks & Libraries',
    keywords: [
      'react', 'react.js', 'reactjs', 'next.js', 'nextjs', 'angular', 'vue.js', 'vuejs', 'svelte',
      'node.js', 'nodejs', 'express', 'express.js', 'django', 'flask', 'fastapi', 'spring',
      'spring boot', '.net', 'asp.net', 'laravel', 'rails', 'ruby on rails', 'tailwind',
      'tailwind css', 'bootstrap', 'jquery', 'redux', 'flutter', 'react native', 'tensorflow',
      'pytorch', 'keras', 'scikit-learn', 'sklearn', 'pandas', 'numpy', 'opencv', 'spacy',
      'nltk', 'langchain', 'hugging face', 'transformers', 'matplotlib', 'seaborn', 'graphql',
      'socket.io', 'mongoose', 'prisma', 'vite', 'electron', 'nestjs', 'mediapipe',
    ],
  },
  {
    category: 'Databases',
    keywords: [
      'mongodb', 'mysql', 'postgresql', 'postgres', 'sqlite', 'redis', 'oracle', 'sql server',
      'mssql', 'firebase', 'firestore', 'dynamodb', 'cassandra', 'elasticsearch', 'mariadb',
      'supabase', 'neo4j', 'faiss',
    ],
  },
  {
    category: 'Cloud & DevOps',
    keywords: [
      'aws', 'azure', 'gcp', 'google cloud', 'docker', 'kubernetes', 'k8s', 'jenkins',
      'github actions', 'ci/cd', 'terraform', 'ansible', 'nginx', 'linux', 'heroku', 'vercel',
      'netlify', 'railway', 'render', 'devops', 'serverless', 'cloudflare',
    ],
  },
  {
    category: 'Tools',
    keywords: [
      'git', 'github', 'gitlab', 'bitbucket', 'jira', 'postman', 'figma', 'vs code',
      'visual studio', 'webpack', 'npm', 'yarn', 'jest', 'selenium', 'playwright', 'cypress',
      'trello', 'notion', 'slack', 'confluence', 'android studio', 'xcode', 'tableau',
      'power bi', 'excel',
    ],
  },
];

const KEYWORD_TO_CATEGORY = new Map();
for (const { category, keywords } of SKILL_CATEGORIES) {
  for (const k of keywords) KEYWORD_TO_CATEGORY.set(k, category);
}

export const categorizeSkills = (skills) => {
  const groups = new Map();
  for (const skill of skills) {
    const category = KEYWORD_TO_CATEGORY.get(skill.toLowerCase()) || 'Other Skills';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(skill);
  }
  const order = [...SKILL_CATEGORIES.map((c) => c.category), 'Other Skills'];
  return order
    .filter((c) => groups.has(c))
    .map((category) => ({ id: newId(), category, items: groups.get(category) }));
};

const dedupeStrings = (arr) => {
  const seen = new Set();
  return arr
    .map((s) => (typeof s === 'string' ? s : s?.name ?? '').trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

// ── Date helpers ─────────────────────────────────────────────────────────────
// Matches "Jan 2020 - Present", "2019 – 2021", "03/2020 to 06/2022" etc.
const RANGE_RE =
  /^\s*([A-Za-z]{0,9}\.?\s*\/?\s*\d{0,2}\s*[/\-.]?\s*\d{4})\s*(?:-|–|—|to|until)\s*([A-Za-z]{0,9}\.?\s*\/?\s*\d{0,2}\s*[/\-.]?\s*\d{4}|present|current|now|ongoing)\s*$/i;

export const splitDateRange = (text) => {
  const m = clean(text).match(RANGE_RE);
  if (!m) return null;
  const end = m[2].trim();
  const current = /^(present|current|now|ongoing)$/i.test(end);
  return { startDate: m[1].trim(), endDate: current ? '' : end, current };
};

// ── Section builders ─────────────────────────────────────────────────────────
const buildExperience = (profile, parsed) => {
  if (profile?.experience?.length) {
    return profile.experience.map((e) => {
      const item = {
        id: newId(),
        title: clean(e.title),
        company: clean(e.company),
        location: clean(e.location),
        startDate: clean(e.startDate),
        endDate: clean(e.endDate),
        current: !!e.current,
        description: clean(e.description),
      };
      // Profile Builder's CV import stores the parsed duration in `description`.
      // Move it back into the date fields when it is clearly only a date range.
      if (!item.startDate && !item.endDate) {
        const range = splitDateRange(item.description);
        if (range) Object.assign(item, range, { description: '' });
      }
      return item;
    });
  }
  return (parsed?.experience || [])
    .filter((e) => clean(e.title) || clean(e.company))
    .map((e) => {
      // Newer parses carry real dates; older ones only a `duration` string.
      const range = clean(e.startDate) || e.current ? null : splitDateRange(e.duration);
      return {
        id: newId(),
        title: clean(e.title) === 'Unknown Title' ? '' : clean(e.title),
        company: clean(e.company) === 'Unknown Company' ? '' : clean(e.company),
        location: clean(e.location),
        startDate: clean(e.startDate) || range?.startDate || '',
        endDate: clean(e.startDate) || e.current ? clean(e.endDate) : range ? range.endDate : clean(e.duration),
        current: !!e.current || range?.current || false,
        description: clean(e.description),
      };
    });
};

const buildEducation = (profile, parsed) => {
  if (profile?.education?.length) {
    return profile.education.map((e) => ({
      id: newId(),
      degree: clean(e.degree),
      field: clean(e.field),
      institution: clean(e.institution),
      location: '',
      startDate: clean(e.startDate),
      endDate: clean(e.endDate),
      gpa: clean(e.gpa),
      details: '',
    }));
  }
  return (parsed?.education || []).map((e) => {
    // Newer parses carry startDate/endDate; older ones only `year`.
    const hasDates = clean(e.startDate) || clean(e.endDate);
    const range = hasDates ? null : splitDateRange(e.year);
    return {
      id: newId(),
      degree: clean(e.degree),
      field: clean(e.field),
      institution: clean(e.institution),
      location: '',
      startDate: hasDates ? clean(e.startDate) : range?.startDate || '',
      endDate: hasDates ? clean(e.endDate) : range ? (range.current ? '' : range.endDate) : clean(e.year),
      gpa: clean(e.gpa),
      details: '',
    };
  });
};

const buildSkills = (profile, parsed) => {
  const fromProfile = dedupeStrings([
    ...(profile?.skills?.manual || []),
    ...(profile?.skills?.cv || []),
    ...(profile?.skills?.extracted || []),
  ]);
  if (fromProfile.length) return fromProfile;
  return dedupeStrings(parsed?.skills || []);
};

const buildProjects = (profile, parsed) => {
  const p = profile?.projects || {};
  const github = (p.github || []).map((r) => ({
    source: 'github',
    name: r.name,
    description: r.description,
    url: r.url,
    technologies: [...(r.languages || []), ...(r.topics || [])],
  }));
  const manual = (p.manual || []).map((m) => ({ ...m, source: 'manual' }));
  const cv = (p.cv || []).map((c) => ({ ...c, source: 'cv' }));

  // `selected` is written by the Profile Builder on save; fall back to the
  // individual source lists when it is missing.
  let candidates = p.selected?.length ? p.selected : [...manual, ...github, ...cv];
  if (!candidates.length) {
    candidates = (parsed?.projects || []).map((c) => ({
      ...c,
      url: c.githubUrl || c.url || '',
      liveUrl: c.liveUrl || '',
      source: 'cv',
    }));
  }

  // Deduplicate by name, preferring user-entered, then GitHub (has URL), then CV.
  const rank = { manual: 0, github: 1, cv: 2 };
  const byName = new Map();
  for (const proj of candidates) {
    const name = clean(proj.name);
    if (!name) continue;
    const key = name.toLowerCase();
    const prev = byName.get(key);
    if (!prev || (rank[proj.source] ?? 3) < (rank[prev.source] ?? 3)) {
      byName.set(key, proj);
    }
  }

  return [...byName.values()].map((proj) => ({
    id: newId(),
    name: clean(proj.name),
    description: clean(proj.description),
    technologies: dedupeStrings(proj.technologies || []),
    url: clean(proj.url),
    liveUrl: clean(proj.liveUrl),
    source: ['manual', 'github', 'cv'].includes(proj.source) ? proj.source : 'manual',
  }));
};

// Profile certifications, else the ones parsed from the CV (FR4.6).
const buildCertifications = (profile, parsed) =>
  (profile?.certifications?.length ? profile.certifications : parsed?.certifications || [])
    .filter((c) => clean(c.name))
    .map((c) => ({
      id: newId(),
      name: clean(c.name),
      issuer: clean(c.issuer),
      date: clean(c.date),
      url: clean(c.url),
    }));

// ── Public API ───────────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  accentColor: 'slate',
  fontFamily: 'sans',
  fontSize: 'medium',
  groupSkills: true,
  sectionOrder: SECTION_KEYS,
  hiddenSections: [],
};

export const buildCvSource = async (userId) => {
  const [user, profile, cvRecord] = await Promise.all([
    User.findById(userId).lean(),
    Profile.findOne({ userId }).lean(),
    getLatestParsedCv(userId.toString()),
  ]);

  // Only completed parses carry usable data (a processing/failed record may be stale).
  const usable = [CV_STATUS.PARSED, CV_STATUS.VERIFIED].includes(cvRecord?.parsing_status);
  const parsed = usable ? cvRecord.parsed_data || null : null;
  const pi = profile?.personalInfo || {};
  const githubUser = clean(profile?.githubData?.username);

  const data = {
    personal: {
      fullName: clean(user?.name),
      headline: '',
      email: clean(user?.email),
      phone: clean(pi.phone),
      location: clean(pi.location),
      linkedin: clean(pi.linkedin),
      github: clean(pi.github) || (githubUser ? `github.com/${githubUser}` : ''),
      website: clean(pi.website),
    },
    summary: clean(profile?.summary),
    skills: categorizeSkills(buildSkills(profile, parsed)),
    experience: buildExperience(profile, parsed),
    education: buildEducation(profile, parsed),
    projects: buildProjects(profile, parsed),
    certifications: buildCertifications(profile, parsed),
  };

  const hasProfile = !!(
    profile &&
    (profile.summary ||
      profile.experience?.length ||
      profile.education?.length ||
      profile.skills?.manual?.length ||
      profile.skills?.cv?.length ||
      profile.skills?.extracted?.length ||
      profile.projects?.manual?.length ||
      profile.projects?.github?.length ||
      profile.projects?.cv?.length ||
      profile.certifications?.length)
  );

  return {
    data,
    sources: {
      profile: hasProfile,
      parsedCv: !!parsed,
      parsedCvStatus: cvRecord?.parsing_status || null,
    },
  };
};
