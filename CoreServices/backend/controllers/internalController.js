import mongoose from 'mongoose';
import User from '../models/User.js';
import { CV_STATUS_VALUES, isValidCvStatus } from '../constants/cvStatus.js';
import { handleServerError } from '../utils/serverError.js';

// @route   GET /internal/users/:userId/auth-state
// @desc    Current auth-relevant user state, for other services' per-request checks
// @access  Internal (X-Internal-Key)
export const getUserAuthState = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = mongoose.Types.ObjectId.isValid(userId)
      ? await User.findById(userId).select('role isActive passwordChangedAt').lean()
      : null;
    if (!user) return res.status(404).json({ exists: false });

    return res.status(200).json({
      exists: true,
      isActive: user.isActive !== false,
      role: user.role,
      passwordChangedAt: user.passwordChangedAt || null,
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'internal', message: 'Failed to read auth state' });
  }
};

// @route   PUT /internal/users/:userId/cv-status
// @desc    Set a user's CV status (pushed by AIServices)
// @access  Internal (X-Internal-Key)
export const setUserCvStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body || {};

    if (!isValidCvStatus(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${CV_STATUS_VALUES.join(', ')}`,
      });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { cvStatus: status },
      { new: true, runValidators: true },
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({ success: true, userId: user._id, cvStatus: user.cvStatus });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'internal', message: 'Failed to update CV status' });
  }
};
