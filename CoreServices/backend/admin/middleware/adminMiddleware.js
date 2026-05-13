import authMiddleware from '../../middleware/auth.js';

// Requires a valid JWT AND Admin role.
// Chain: authMiddleware validates the token, then we check the role.
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'Admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.',
    });
  }
  next();
};

// Export as array so routes can spread it: router.get('/...', adminAuthMiddleware, handler)
export const adminAuthMiddleware = [authMiddleware, requireAdmin];
