import mongoose from 'mongoose';

// 12: users whose cached AI outputs in AIServices could not be deleted (consent withdrawn / account
// deleted while AIServices was unreachable). The hourly job retries them; success removes the entry.
// Holds the user id and attempt counts only — no content.
const pendingLlmDeletionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, maxlength: 64 },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, maxlength: 100, default: '' },
    createdAt: { type: Date, default: Date.now },
    lastTriedAt: { type: Date, default: Date.now },
  },
  { collection: 'pending_llm_deletions', versionKey: false }
);

const PendingLlmDeletion = mongoose.model('PendingLlmDeletion', pendingLlmDeletionSchema);
export default PendingLlmDeletion;
