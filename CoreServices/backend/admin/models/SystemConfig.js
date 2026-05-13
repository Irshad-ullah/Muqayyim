import mongoose from 'mongoose';

const systemConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, 'Config key is required'],
      unique: true,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'Config value is required'],
    },
    description: { type: String, default: '' },
    category: {
      type: String,
      enum: ['general', 'matching', 'scoring', 'parser', 'features'],
      default: 'general',
    },
    dataType: {
      type: String,
      enum: ['string', 'number', 'boolean', 'json'],
      default: 'string',
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

systemConfigSchema.index({ category: 1, key: 1 });

const SystemConfig = mongoose.model('SystemConfig', systemConfigSchema);
export default SystemConfig;
