import mongoose from 'mongoose';

const skillTaxonomySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Skill name is required'],
      trim: true,
      unique: true,
    },
    category: { type: String, required: true }, // e.g. 'programming', 'soft-skills', 'tools'
    subcategory: { type: String, default: '' },
    aliases: { type: [String], default: [] },
    relatedProfessions: { type: [String], default: [] },
    source: {
      type: String,
      enum: ['manual', 'esco', 'onet'],
      default: 'manual',
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

skillTaxonomySchema.index({ name: 'text' });
skillTaxonomySchema.index({ category: 1, isActive: 1 });

const SkillTaxonomy = mongoose.model('SkillTaxonomy', skillTaxonomySchema);
export default SkillTaxonomy;
