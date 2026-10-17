import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';
import { CV_STATUS, CV_STATUS_VALUES } from '../constants/cvStatus.js';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
      maxlength: [100, 'Name cannot be more than 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
        'Please provide a valid email',
      ],
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: 6,
      select: false, // Don't return password by default
    },
    role: {
      type: String,
      enum: ['JobSeeker', 'Admin'],
      default: 'JobSeeker',
    },
    cvStatus: {
      type: String,
      enum: CV_STATUS_VALUES,
      default: CV_STATUS.NOT_UPLOADED,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Login lockout (FR1.2 / SEC-3). Separate from admin deactivation (isActive).
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    // LLM features (12): one-time consent to send CV / profile text to the AI provider. Valid only for
    // the consent version it was given for (constants/aiConsent.js); without it AI features are off.
    aiConsent: {
      granted: { type: Boolean, default: false },
      version: { type: String, default: null },
      provider: { type: String, default: null },
      grantedAt: { type: Date, default: null },
      withdrawnAt: { type: Date, default: null },
    },
    resetToken: String,
    resetTokenExpiry: Date,
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  // Only hash if password is modified
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcryptjs.genSalt(10);
    this.password = await bcryptjs.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcryptjs.compare(enteredPassword, this.password);
};

// True while a temporary lockout is in effect (an expired lock counts as unlocked).
userSchema.methods.isLocked = function (now = Date.now()) {
  return !!(this.lockUntil && this.lockUntil.getTime() > now);
};

const User = mongoose.model('User', userSchema);

export default User;
