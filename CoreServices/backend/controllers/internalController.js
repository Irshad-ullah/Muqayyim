import mongoose from 'mongoose';
import User from '../models/User.js';
import { CV_STATUS_VALUES, isValidCvStatus } from '../constants/cvStatus.js';

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
    console.error('Internal set CV status error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to update CV status' });
  }
};
