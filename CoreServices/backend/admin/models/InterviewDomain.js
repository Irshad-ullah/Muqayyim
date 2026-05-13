import mongoose from 'mongoose';

const interviewDomainSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Domain name is required'],
      trim: true,
    },
    description: { type: String, default: '' },
    parentDomain: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InterviewDomain',
      default: null,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

interviewDomainSchema.index({ name: 1, isActive: 1 });

const InterviewDomain = mongoose.model('InterviewDomain', interviewDomainSchema);
export default InterviewDomain;
