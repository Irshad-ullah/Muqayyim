import mongoose from 'mongoose';

const adminLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: { type: String, required: true },    // e.g. 'UPDATE_USER', 'DELETE_CONFIG'
    resource: { type: String, required: true },  // e.g. 'User', 'SystemConfig'
    resourceId: { type: String, default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    status: {
      type: String,
      enum: ['success', 'failure'],
      default: 'success',
    },
  },
  { timestamps: true }
);

adminLogSchema.index({ adminId: 1, createdAt: -1 });
adminLogSchema.index({ resource: 1, action: 1 });
adminLogSchema.index({ createdAt: -1 });

const AdminLog = mongoose.model('AdminLog', adminLogSchema);
export default AdminLog;
