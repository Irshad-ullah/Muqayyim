import mongoose from 'mongoose';

// Module 6 (FR8.1–FR8.9): a saved learning path for one career match. The structure (modules, order, tiers, quick
// wins) comes from AIServices' deterministic planner; the enrichment (why, sub-topics, project, estimated hours,
// AI recommendations with search links built by AIServices; English only) from the LLM, when available. A path is saved and never
// regenerated on view; `snapshot` lets the page offer "Regenerate?" when the profile or the career data changed.

const { Schema } = mongoose;
const str = (max) => ({ type: String, default: '', maxlength: max });

const recommendationSchema = new Schema({
  platform: str(40), title: str(160), instructor: str(100), description: str(300),
  free: { type: Boolean, default: true },
  searchUrl: str(600), searchLabel: str(60), label: str(80),
}, { _id: false });

const moduleSchema = new Schema({
  key: { type: String, required: true, maxlength: 120 },
  skill: str(120),
  requirementKey: str(120),
  requirement: str(200),
  tier: { type: String, enum: ['essential', 'optional'], default: 'optional' },
  order: { type: Number, default: 0 },
  quickWin: { type: Boolean, default: false },
  hint: { skill: str(120), similarity: Number },
  alternatives: { type: [{ name: str(120), key: str(120), _id: false }], default: [] },
  prerequisites: { type: [String], default: [] },
  why: str(400),
  subtopics: { type: [String], default: [] },
  project: str(400),
  hours: { min: Number, max: Number },
  recommendations: { type: [recommendationSchema], default: [] },
  status: { type: String, enum: ['not_started', 'in_progress', 'completed'], default: 'not_started' },
  // AI details of this module: enriched, pending (the automatic retry is running) or failed ("Retry AI details").
  aiStatus: { type: String, enum: ['enriched', 'pending', 'failed'] },
  startedAt: Date,
  completedAt: Date,
}, { _id: false });

const learningPathSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  professionId: { type: String, required: true, maxlength: 120 },
  title: str(200),
  source: str(20),
  sourceVersion: str(60),
  matchScore: Number,
  preferences: {
    cost: { type: String, enum: ['free', 'include_paid'], default: 'free' },
    hoursPerWeek: { type: Number, min: 1, max: 60, default: 5 },
  },
  choices: { type: Schema.Types.Mixed, default: {} },
  modules: { type: [moduleSchema], default: [] },
  more: { count: { type: Number, default: 0 }, skills: { type: [String], default: [] } },
  totalHours: { min: Number, max: Number },
  enrichment: {
    status: { type: String, enum: ['enriched', 'partial', 'unavailable', 'failed'], default: 'unavailable' },
    code: str(60), prompt: str(60), model: str(80), cached: Boolean,
  },
  snapshot: { skillsHash: str(80), datasetHash: str(80), scoringMode: str(20), algorithm: str(40) },
  feedback: {
    type: [{ moduleKey: str(120), title: str(160), vote: { type: String, enum: ['up', 'down'] }, at: Date, _id: false }],
    default: [],
  },
}, { timestamps: true, collection: 'learningpaths' });

learningPathSchema.index({ userId: 1, professionId: 1 }, { unique: true });

const LearningPath = mongoose.model('LearningPath', learningPathSchema);
export default LearningPath;
