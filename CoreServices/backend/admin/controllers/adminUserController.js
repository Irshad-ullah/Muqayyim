import User from '../../models/User.js';
import Profile from '../../models/Profile.js';
import { auditLog } from '../utils/auditLog.js';
import { normalizeEmail, isDuplicateKeyError, emailInUse } from '../../utils/apiErrors.js';

const SAFE_FIELDS = '-password -resetToken -resetTokenExpiry';

// True when `user` is the only active admin left (so it must not be removed,
// deactivated or demoted). Defense in depth: through the API the acting admin
// is itself an active admin and cannot target itself, so this guards future
// endpoints/scripts against leaving the system with no active admin.
export const isLastActiveAdmin = async (user) => {
  if (user.role !== 'Admin' || user.isActive === false) return false;
  const others = await User.countDocuments({ _id: { $ne: user._id }, role: 'Admin', isActive: { $ne: false } });
  return others === 0;
};

// Adds the temporary-lock state (separate from admin deactivation) to a user.
const withLockState = (user) => {
  const obj = user.toObject();
  return { ...obj, isLocked: user.isLocked(), lockUntil: user.isLocked() ? user.lockUntil : null };
};

// @route   GET /api/admin/users
// @desc    Paginated, filterable user list
// @access  Admin
export const listUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      role,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const filter = {};
    if (role) filter.role = role;
    if (status === 'active') filter.isActive = { $ne: false };
    if (status === 'inactive') filter.isActive = false;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .select(SAFE_FIELDS),
      User.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: users.map(withLockState),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('List users error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
};

// @route   GET /api/admin/users/:id
// @desc    Get a single user + their profile
// @access  Admin
export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(SAFE_FIELDS);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const profile = await Profile.findOne({ userId: user._id });

    return res.json({ success: true, data: { user: withLockState(user), profile: profile || null } });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
};

// @route   PUT /api/admin/users/:id
// @desc    Update basic user info (name, email)
// @access  Admin
export const updateUser = async (req, res) => {
  try {
    const { name } = req.body;
    const email = req.body.email !== undefined ? normalizeEmail(req.body.email) : undefined;

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (email && email !== user.email) {
      const taken = await User.exists({ email, _id: { $ne: user._id } });
      if (taken) return emailInUse(res);
    }

    if (name) user.name = name;
    if (email) user.email = email;

    await user.save();
    await auditLog(req.user.userId, 'UPDATE_USER', 'User', user._id, { name, email }, req);

    return res.json({
      success: true,
      message: 'User updated',
      data: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) return emailInUse(res);
    console.error('Update user error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update user' });
  }
};

// @route   POST /api/admin/users/:id/unlock
// @desc    Clear a temporary login lockout (failed-attempt counter + lock)
// @access  Admin
export const unlockUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const wasLocked = user.isLocked();
    const previousAttempts = user.failedLoginAttempts || 0;

    await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 0, lockUntil: null } });
    await auditLog(req.user.userId, 'UNLOCK_USER', 'User', user._id, { wasLocked, previousAttempts }, req);

    return res.json({
      success: true,
      message: wasLocked ? 'User unlocked' : 'User was not locked; failed attempts cleared',
      data: { userId: user._id, isLocked: false, lockUntil: null },
    });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    console.error('Unlock user error:', error);
    return res.status(500).json({ success: false, message: 'Failed to unlock user' });
  }
};

// @route   PATCH /api/admin/users/:id/status
// @desc    Activate or deactivate a user account
// @access  Admin
export const toggleUserStatus = async (req, res) => {
  try {
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive must be a boolean' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user._id.toString() === req.user.userId && !isActive) {
      return res.status(400).json({ success: false, message: 'Cannot deactivate your own account' });
    }

    if (!isActive && (await isLastActiveAdmin(user))) {
      return res.status(400).json({ success: false, message: 'Cannot deactivate the last active admin' });
    }

    user.isActive = isActive;
    await user.save();

    const action = isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER';
    await auditLog(req.user.userId, action, 'User', user._id, { isActive }, req);

    return res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'}`,
      data: { userId: user._id, isActive: user.isActive },
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update user status' });
  }
};

// @route   PATCH /api/admin/users/:id/role
// @desc    Change a user's role
// @access  Admin
export const updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    const allowedRoles = ['JobSeeker', 'Admin'];

    if (!role || !allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `role must be one of: ${allowedRoles.join(', ')}`,
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user._id.toString() === req.user.userId) {
      return res.status(400).json({ success: false, message: 'Cannot change your own role' });
    }

    if (role !== 'Admin' && (await isLastActiveAdmin(user))) {
      return res.status(400).json({ success: false, message: 'Cannot demote the last active admin' });
    }

    const previousRole = user.role;
    user.role = role;
    await user.save();

    await auditLog(req.user.userId, 'CHANGE_USER_ROLE', 'User', user._id, { previousRole, newRole: role }, req);

    return res.json({
      success: true,
      message: 'User role updated',
      data: { userId: user._id, role: user.role },
    });
  } catch (error) {
    console.error('Update user role error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update user role' });
  }
};

// @route   DELETE /api/admin/users/:id
// @desc    Permanently delete a user and their profile
// @access  Admin
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user._id.toString() === req.user.userId) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }

    if (await isLastActiveAdmin(user)) {
      return res.status(400).json({ success: false, message: 'Cannot delete the last active admin' });
    }

    await auditLog(req.user.userId, 'DELETE_USER', 'User', user._id, { email: user.email }, req);

    await Promise.all([
      User.findByIdAndDelete(req.params.id),
      Profile.findOneAndDelete({ userId: req.params.id }),
    ]);

    return res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
};
