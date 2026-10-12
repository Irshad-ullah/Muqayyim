import mongoose from 'mongoose';

// Security events (account locked, password changed/reset, …) written by
// logSecurityEvent(). Details are masked; never passwords or tokens.
const securityEventSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now },
    event: { type: String, required: true, maxlength: 100 },
    userId: { type: String, maxlength: 64 },
    ip: { type: String, maxlength: 100 },
    requestId: { type: String, maxlength: 64 },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { collection: 'security_events', versionKey: false, bufferCommands: false }
);

securityEventSchema.index({ timestamp: -1 });
securityEventSchema.index({ event: 1, timestamp: -1 });
securityEventSchema.index({ userId: 1, timestamp: -1 });

const SecurityEvent = mongoose.model('SecurityEvent', securityEventSchema);
export default SecurityEvent;
