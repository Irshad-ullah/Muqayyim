import mongoose from 'mongoose';

// Module 4 — AI-Powered CV Generator
// A saved CV is a self-contained snapshot: the structured CV content as the
// user edited it, plus the template and design settings. It never references
// the live Profile, so later profile edits do not change an old saved CV.

export const TEMPLATES = ['classic', 'modern', 'compact'];
export const SECTION_KEYS = [
  'summary',
  'skills',
  'experience',
  'projects',
  'education',
  'certifications',
];

const { Schema } = mongoose;
const str = (max) => ({ type: String, default: '', trim: true, maxlength: max });

const experienceSchema = new Schema(
  {
    id: str(40),
    title: str(200),
    company: str(200),
    location: str(200),
    startDate: str(40),
    endDate: str(40),
    current: { type: Boolean, default: false },
    description: str(4000),
  },
  { _id: false },
);

const educationSchema = new Schema(
  {
    id: str(40),
    degree: str(200),
    field: str(200),
    institution: str(200),
    location: str(200),
    startDate: str(40),
    endDate: str(40),
    gpa: str(40),
    details: str(1000),
  },
  { _id: false },
);

const projectSchema = new Schema(
  {
    id: str(40),
    name: str(200),
    description: str(3000),
    technologies: { type: [String], default: [] },
    url: str(500),
    liveUrl: str(500),
    source: { type: String, enum: ['manual', 'github', 'cv'], default: 'manual' },
  },
  { _id: false },
);

const certificationSchema = new Schema(
  {
    id: str(40),
    name: str(200),
    issuer: str(200),
    date: str(40),
    url: str(500),
  },
  { _id: false },
);

const skillGroupSchema = new Schema(
  {
    id: str(40),
    category: str(80),
    items: { type: [String], default: [] },
  },
  { _id: false },
);

const cvDataSchema = new Schema(
  {
    personal: {
      fullName: str(120),
      headline: str(160),
      email: str(200),
      phone: str(60),
      location: str(200),
      linkedin: str(500),
      github: str(500),
      website: str(500),
    },
    summary: str(2000),
    skills: { type: [skillGroupSchema], default: [] },
    experience: { type: [experienceSchema], default: [] },
    education: { type: [educationSchema], default: [] },
    projects: { type: [projectSchema], default: [] },
    certifications: { type: [certificationSchema], default: [] },
  },
  { _id: false },
);

const settingsSchema = new Schema(
  {
    accentColor: { type: String, default: 'slate' },
    fontFamily: { type: String, enum: ['sans', 'serif'], default: 'sans' },
    fontSize: { type: String, enum: ['small', 'medium', 'large'], default: 'medium' },
    groupSkills: { type: Boolean, default: true },
    sectionOrder: { type: [String], default: SECTION_KEYS },
    hiddenSections: { type: [String], default: [] },
  },
  { _id: false },
);

const generatedCvSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    template: { type: String, enum: TEMPLATES, default: 'classic' },
    settings: { type: settingsSchema, default: () => ({}) },
    data: { type: cvDataSchema, default: () => ({}) },
    // Which sources the snapshot was originally built from (informational only).
    sources: {
      profile: { type: Boolean, default: false },
      parsedCv: { type: Boolean, default: false },
    },
    snapshotAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

generatedCvSchema.index({ userId: 1, updatedAt: -1 });

const GeneratedCv = mongoose.model('GeneratedCv', generatedCvSchema);
export default GeneratedCv;
