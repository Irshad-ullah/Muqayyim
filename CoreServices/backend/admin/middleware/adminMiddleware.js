import authMiddleware from '../../middleware/auth.js';

// Requires a valid JWT AND Admin role.
// Chain: authMiddleware validates the token and loads the user from the
// database; req.user.role is the DATABASE role (the token's role claim is
// never used), so a demoted admin loses access on their next request.
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
