import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcryptjs from 'bcryptjs';
import User from '../models/User.js';
import { sendPasswordResetEmail, sendPasswordChangedEmail } from '../utils/emailService.js';
import { validateEmail } from '../utils/emailValidator.js';
import { validatePassword, passwordErrorResponse } from '../utils/passwordPolicy.js';
import { MAX_LOGIN_ATTEMPTS, LOCK_DURATION_MS } from '../config/security.js';
import { logSecurityEvent } from '../utils/securityLog.js';
import { normalizeEmail, isDuplicateKeyError, emailInUse } from '../utils/apiErrors.js';
import { passwordChangedTimestamp } from '../utils/passwordChangedAt.js';
import { handleServerError } from '../utils/serverError.js';

const INVALID_CREDENTIALS = 'Invalid email or password';

// Compared against when the email is unknown, so the response takes as long as
// a real password check and timing doesn't reveal whether the email exists.
const DUMMY_PASSWORD_HASH = bcryptjs.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const minutesUntil = (date) => Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60000));

const lockedResponse = (res, lockUntil) => {
  const retryAfterMinutes = minutesUntil(lockUntil);
  return res.status(423).json({
    success: false,
    message: `Account temporarily locked due to too many failed attempts. Try again in ${retryAfterMinutes} minute${retryAfterMinutes === 1 ? '' : 's'}.`,
    retryAfterMinutes,
  });
};

// Generate JWT token
const generateToken = (userId, role) => {
  return jwt.sign({ userId, id: userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
export const register = async (req, res) => {
  try {
    const { name, password, passwordConfirm } = req.body;
    const email = normalizeEmail(req.body.email);

    // Validation
    if (!name || !email || !password || !passwordConfirm) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
      });
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      return res.status(400).json(passwordErrorResponse(passwordCheck.errors));
    }

    if (password !== passwordConfirm) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
        field: 'passwordConfirm',
      });
    }

    // Email validation: format → disposable domain → DNS MX record
    const emailCheck = await validateEmail(email);
    if (!emailCheck.valid) {
      return res.status(400).json({
        success: false,
        message: emailCheck.reason,
      });
    }

    // Check if user already exists (the unique index also catches races below)
    const existingUser = await User.findOne({ email });
    if (existingUser) return emailInUse(res);

    // Create user
    const user = await User.create({
      name,
      email,
      password,
    });

    // Generate token
    const token = generateToken(user._id, user.role);

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        cvStatus: user.cvStatus,
      },
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) return emailInUse(res);
    return handleServerError(res, req, error, { module: 'auth', message: 'Registration failed' });
  }
};

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
export const login = async (req, res) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    // Find user and select password
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      await bcryptjs.compare(String(password), DUMMY_PASSWORD_HASH);
      return res.status(401).json({ success: false, message: INVALID_CREDENTIALS });
    }

    // Locked: refuse without checking the password.
    if (user.isLocked()) {
      return lockedResponse(res, user.lockUntil);
    }

    // Compare passwords
    const isPasswordValid = await user.comparePassword(String(password));
    if (!isPasswordValid) {
      // One atomic update so parallel requests can't skip the counter:
      // an expired lock restarts the count at 1; reaching the limit sets the lock.
      const now = new Date();
      const lockUntil = new Date(now.getTime() + LOCK_DURATION_MS);
      const lockExpired = {
        $and: [{ $ne: [{ $ifNull: ['$lockUntil', null] }, null] }, { $lte: ['$lockUntil', now] }],
      };
      const updated = await User.findOneAndUpdate(
        { _id: user._id },
        [
          {
            $set: {
              failedLoginAttempts: {
                $cond: [lockExpired, 1, { $add: [{ $ifNull: ['$failedLoginAttempts', 0] }, 1] }],
              },
              lockUntil: { $cond: [lockExpired, null, { $ifNull: ['$lockUntil', null] }] },
            },
          },
          {
            $set: {
              lockUntil: {
                $cond: [
                  { $and: [{ $gte: ['$failedLoginAttempts', MAX_LOGIN_ATTEMPTS] }, { $eq: ['$lockUntil', null] }] },
                  lockUntil,
                  '$lockUntil',
                ],
              },
            },
          },
        ],
        { new: true },
      );

      if (updated?.isLocked()) {
        // Log only when this attempt set the lock (not a parallel one).
        if (updated.lockUntil.getTime() === lockUntil.getTime()) {
          logSecurityEvent('Account locked', {
            userId: String(user._id),
            ip: req.ip,
            requestId: req.requestId,
            failedLoginAttempts: updated.failedLoginAttempts,
            lockUntil: updated.lockUntil.toISOString(),
          });
        }
        return lockedResponse(res, updated.lockUntil);
      }
      return res.status(401).json({ success: false, message: INVALID_CREDENTIALS });
    }

    // Reject deactivated accounts
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.',
      });
    }

    // Success: clear any failed-attempt state and record the login.
    await User.updateOne(
      { _id: user._id },
      { $set: { failedLoginAttempts: 0, lockUntil: null, lastLogin: new Date() } },
    );

    // Generate token
    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        cvStatus: user.cvStatus,
      },
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'auth', message: 'Login failed' });
  }
};

// @route   GET /api/auth/profile
// @desc    Get user profile
// @access  Private
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        // Owned by the server: pushed by AIServices via /internal routes.
        cvStatus: user.cvStatus,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'auth', message: 'Failed to fetch profile' });
  }
};

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
export const updateProfile = async (req, res) => {
  try {
    const { name } = req.body;
    const email = req.body.email !== undefined ? normalizeEmail(req.body.email) : undefined;

    // Find and update user
    let user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if new email is valid and not already in use
    if (email && email !== user.email) {
      const emailCheck = await validateEmail(email);
      if (!emailCheck.valid) {
        return res.status(400).json({
          success: false,
          message: emailCheck.reason,
        });
      }
      const existingUser = await User.findOne({ email, _id: { $ne: user._id } });
      if (existingUser) return emailInUse(res);
    }

    // Update fields
    if (name) user.name = name;
    if (email) user.email = email;

    user = await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        cvStatus: user.cvStatus,
      },
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) return emailInUse(res);
    return handleServerError(res, req, error, { module: 'auth', message: 'Failed to update profile' });
  }
};

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email
// @access  Public
export const forgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email',
      });
    }

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
      // Don't reveal if user exists for security
      return res.status(200).json({
        success: true,
        message: 'If email exists, password reset link will be sent',
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetTokenExpiry = Date.now() + 60 * 60 * 1000; // 1 hour

    await user.save();

    // Send email
    const emailSent = await sendPasswordResetEmail(user.email, resetToken);

    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send reset email',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Password reset link sent to email',
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'auth', message: 'Failed to process forgot password' });
  }
};

// @route   POST /api/auth/reset-password/:token
// @desc    Reset password with token
// @access  Public
export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, passwordConfirm } = req.body;

    if (!password || !passwordConfirm) {
      return res.status(400).json({
        success: false,
        message: 'Please provide new password',
      });
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      return res.status(400).json(passwordErrorResponse(passwordCheck.errors));
    }

    if (password !== passwordConfirm) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
        field: 'passwordConfirm',
      });
    }

    // Hash token to compare
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with valid token
    const user = await User.findOne({
      resetToken: hashedToken,
      resetTokenExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token',
      });
    }

    // Update password
    user.password = password;
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    // Revokes every existing session (tokens issued before this moment).
    user.passwordChangedAt = passwordChangedTimestamp();
    // A successful reset also clears any lockout.
    user.failedLoginAttempts = 0;
    user.lockUntil = null;

    await user.save();

    logSecurityEvent('Password reset', { userId: String(user._id), ip: req.ip, requestId: req.requestId });

    return res.status(200).json({
      success: true,
      message: 'Password reset successful',
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'auth', message: 'Failed to reset password' });
  }
};

// @route   PUT /api/auth/password
// @desc    Change password for the logged-in user (returns a fresh token)
// @access  Private
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword) {
      return res.status(400).json({
        success: false,
        field: 'currentPassword',
        message: 'Current password is required',
      });
    }

    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.valid) {
      return res.status(400).json(passwordErrorResponse(passwordCheck.errors, 'newPassword'));
    }

    const user = await User.findById(req.user.userId).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // 400 (not 401): a wrong current password must not look like an expired session.
    if (!(await user.comparePassword(String(currentPassword)))) {
      return res.status(400).json({
        success: false,
        field: 'currentPassword',
        message: 'Current password is incorrect',
      });
    }

    if (await user.comparePassword(newPassword)) {
      return res.status(400).json({
        success: false,
        field: 'newPassword',
        message: 'New password must be different from your current password',
      });
    }

    user.password = newPassword; // hashed by the pre-save hook
    // Revokes older tokens; the fresh token issued below is newer and stays valid.
    user.passwordChangedAt = passwordChangedTimestamp();
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    logSecurityEvent('Password changed', { userId: String(user._id), ip: req.ip, requestId: req.requestId });

    // Non-blocking notification; a mail failure never fails the request.
    sendPasswordChangedEmail(user.email, user.name)
      .then((sent) => {
        if (!sent) console.error(`Password-changed email not sent for user ${user._id}`);
      })
      .catch((err) => console.error(`Password-changed email error for user ${user._id}:`, err.message));

    // Fresh token so the current session stays signed in.
    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      token,
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'auth', message: 'Failed to change password' });
  }
};

// @route   GET /api/auth/cv-status
// @desc    Get CV status for authenticated user
// @access  Private
export const getCVStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      cvStatus: user.cvStatus,
      userId: user._id,
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'auth', message: 'Failed to fetch CV status' });
  }
};
