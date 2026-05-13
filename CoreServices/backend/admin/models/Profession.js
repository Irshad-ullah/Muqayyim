import mongoose from 'mongoose';

const professionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Profession title is required'],
      trim: true,
    },
    code: { type: String, trim: true, default: '' }, // ESCO / O*NET code
    source: {
      type: String,
      enum: ['manual', 'esco', 'onet'],
      default: 'manual',
    },
    category: { type: String, default: '' },
    description: { type: String, default: '' },
    alternativeTitles: { type: [String], default: [] },
    requiredSkills: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

professionSchema.index({ title: 'text', code: 1 });
professionSchema.index({ category: 1, isActive: 1 });

const Profession = mongoose.model('Profession', professionSchema);
export default Profession;
