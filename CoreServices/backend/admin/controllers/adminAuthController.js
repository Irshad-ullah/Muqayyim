import User from '../../models/User.js';
import { auditLog } from '../utils/auditLog.js';

// @route   POST /api/admin/auth/create-admin
// @desc    Promote an existing user to Admin OR create a new Admin account
// @access  Admin only
export const createAdminUser = async (req, res) => {
  try {
    const { email, name, password } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      if (user.role === 'Admin') {
        return res.status(409).json({ success: false, message: 'User is already an Admin' });
      }

      user.role = 'Admin';
      await user.save();

      await auditLog(req.user.userId, 'PROMOTE_TO_ADMIN', 'User', user._id, { email }, req);

      return res.json({
        success: true,
        message: `${email} promoted to Admin`,
        data: { id: user._id, email: user.email, role: user.role },
      });
    }

    // Create a brand-new Admin account
    if (!name || !password) {
      return res.status(400).json({
        success: false,
        message: 'name and password are required when creating a new Admin',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      role: 'Admin',
    });

    await auditLog(req.user.userId, 'CREATE_ADMIN', 'User', user._id, { email }, req);

    return res.status(201).json({
      success: true,
      message: 'Admin user created',
      data: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error('Create admin error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create admin user' });
  }
};
