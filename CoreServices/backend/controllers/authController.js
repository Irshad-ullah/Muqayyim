import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import CvData from '../models/CvData.js';
import { sendPasswordResetEmail } from '../utils/emailService.js';
import { validateEmail } from '../utils/emailValidator.js';

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
    const { name, email, password, passwordConfirm } = req.body;

    // Validation
    if (!name || !email || !password || !passwordConfirm) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
      });
    }

    if (password !== passwordConfirm) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
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

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered',
      });
    }

    // Create user
    const user = await User.create({
      name,
      email: email.toLowerCase(),
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
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message,
    });
  }
};

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    // Find user and select password
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+password'
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Compare passwords
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Reject deactivated accounts
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.',
      });
    }

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
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message,
    });
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

    // If the stored status implies data exists, verify it actually does.
    // Auto-reset to "Not Uploaded" when the parsed data has been deleted.
    let cvStatus = user.cvStatus;
    if (cvStatus !== 'Not Uploaded') {
      const record = await CvData.findOne({ user_id: user._id.toString() });
      if (!record) {
        cvStatus = 'Not Uploaded';
        user.cvStatus = 'Not Uploaded';
        await user.save();
      }
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        cvStatus,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
      error: error.message,
    });
  }
};

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
export const updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;

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
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use',
        });
      }
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
    console.error('Update profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message,
    });
  }
};

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email
// @access  Public
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email',
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });

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
    console.error('Forgot password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process forgot password',
      error: error.message,
    });
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

    if (password !== passwordConfirm) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
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

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password reset successful',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset password',
      error: error.message,
    });
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

    let cvStatus = user.cvStatus;
    if (cvStatus !== 'Not Uploaded') {
      const record = await CvData.findOne({ user_id: user._id.toString() });
      if (!record) {
        cvStatus = 'Not Uploaded';
        user.cvStatus = 'Not Uploaded';
        await user.save();
      }
    }

    return res.status(200).json({
      success: true,
      cvStatus,
      userId: user._id,
    });
  } catch (error) {
    console.error('Get CV status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch CV status',
      error: error.message,
    });
  }
};

// @route   PATCH /api/auth/cv-status
// @desc    Update CV status for authenticated user (called internally via API Gateway)
// @access  Private
export const updateCVStatus = async (req, res) => {
  try {
    const { cvStatus } = req.body;
    const allowedStatuses = ['Not Uploaded', 'Uploaded', 'Processing', 'Verified'];

    if (!cvStatus || !allowedStatuses.includes(cvStatus)) {
      return res.status(400).json({
        success: false,
        message: `cvStatus must be one of: ${allowedStatuses.join(', ')}`,
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { cvStatus },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'CV status updated',
      cvStatus: user.cvStatus,
      userId: user._id,
    });
  } catch (error) {
    console.error('Update CV status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update CV status',
      error: error.message,
    });
  }
};
