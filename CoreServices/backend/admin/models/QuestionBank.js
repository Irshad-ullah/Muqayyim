import mongoose from 'mongoose';

const questionBankSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: [true, 'Question text is required'],
      trim: true,
    },
    domain: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InterviewDomain',
      required: [true, 'Domain is required'],
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium',
    },
    type: {
      type: String,
      enum: ['technical', 'behavioral', 'situational'],
      default: 'technical',
    },
    tags: { type: [String], default: [] },
    expectedAnswer: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

questionBankSchema.index({ domain: 1, difficulty: 1, isActive: 1 });
questionBankSchema.index({ question: 'text' });

const QuestionBank = mongoose.model('QuestionBank', questionBankSchema);
export default QuestionBank;
