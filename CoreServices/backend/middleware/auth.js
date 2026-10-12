import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { isTokenRevoked } from '../utils/passwordChangedAt.js';
import { handleServerError } from '../utils/serverError.js';

// Verifies the JWT, then checks the user's current state in the database on
// every request (one projected, lean lookup). Authorization downstream uses
// the database role and isActive — never the token's role claim — so
// suspension, demotion and password changes take effect immediately.
// A temporary login lock (lockUntil) intentionally does not end sessions.
const authMiddleware = async (req, res, next) => {
  let decoded;
  try {
    // Get token from header
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        code: 'NO_TOKEN',
        message: 'No token provided. Please login.',
      });
    }

    // Verify token
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        code: 'TOKEN_EXPIRED',
        message: 'Token expired. Please login again.',
      });
    }

    return res.status(401).json({
      success: false,
      code: 'TOKEN_INVALID',
      message: 'Invalid token. Please login again.',
    });
  }

  try {
    const userId = decoded.userId || decoded.id;
    const user = mongoose.Types.ObjectId.isValid(userId)
      ? await User.findById(userId).select('role isActive passwordChangedAt').lean()
      : null;

    if (!user) {
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'Your account no longer exists. Please login again.',
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DEACTIVATED',
        message: 'Your account has been suspended. Contact support.',
      });
    }

    if (isTokenRevoked(decoded.iat, user.passwordChangedAt)) {
      return res.status(401).json({
        success: false,
        code: 'TOKEN_REVOKED',
        message: 'Your session has ended. Please log in again.',
      });
    }

    // Database state only. `userId` is kept as an alias for existing handlers.
    const id = String(user._id);
    req.user = { id, userId: id, role: user.role, isActive: user.isActive !== false };
    return next();
  } catch (error) {
    return handleServerError(res, req, error, { module: 'auth', message: 'Authentication check failed' });
  }
};

export default authMiddleware;
