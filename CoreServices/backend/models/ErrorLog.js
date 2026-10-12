import mongoose from 'mongoose';

// Central error log (FR-B11, REL-2). Core stores its own entries and the
// gateway's (sent via POST /internal/logs); AIServices keeps its own in ai_db.
export const LOG_LEVELS = ['warning', 'error', 'critical'];
export const LOG_SERVICES = ['core', 'ai', 'gateway'];

const errorLogSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now },
    level: { type: String, enum: LOG_LEVELS, required: true },
    service: { type: String, enum: LOG_SERVICES, required: true },
    module: { type: String, default: 'unknown', maxlength: 60 },
    errorType: { type: String, default: 'Error', maxlength: 120 },
    message: { type: String, default: '', maxlength: 1000 },
    stack: { type: String, maxlength: 4000 },
    requestId: { type: String, maxlength: 64 },
    userId: { type: String, maxlength: 64 },
    method: { type: String, maxlength: 10 },
    path: { type: String, maxlength: 300 },
    statusCode: { type: Number },
    acknowledged: { type: Boolean, default: false },
    acknowledgedBy: { type: String },
    acknowledgedAt: { type: Date },
  },
  {
    collection: 'error_logs',
    versionKey: false,
    // Never queue log writes while MongoDB is unavailable: fail fast and fall
    // back to the console instead of holding them in memory.
    bufferCommands: false,
  }
);

errorLogSchema.index({ timestamp: -1 });
errorLogSchema.index({ service: 1, level: 1, timestamp: -1 });
// TTL index on `timestamp` is managed by ensureLogIndexes (retention is configurable).

const ErrorLog = mongoose.model('ErrorLog', errorLogSchema);
export default ErrorLog;
