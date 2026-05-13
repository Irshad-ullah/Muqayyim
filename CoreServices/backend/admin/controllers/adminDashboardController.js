import { metricsAggregator } from '../services/metricsService.js';

// @route   GET /api/admin/dashboard/metrics
// @desc    Full metrics breakdown from all registered providers
// @access  Admin
export const getDashboardMetrics = async (req, res) => {
  try {
    const metrics = await metricsAggregator.aggregate();
    return res.json({
      success: true,
      availableProviders: metricsAggregator.registeredKeys(),
      metrics,
    });
  } catch (error) {
    console.error('Dashboard metrics error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch metrics' });
  }
};

// @route   GET /api/admin/dashboard/summary
// @desc    Flat KPI summary — safe defaults for unimplemented future modules
// @access  Admin
export const getDashboardSummary = async (req, res) => {
  try {
    const metrics = await metricsAggregator.aggregate(['users', 'cv']);

    return res.json({
      success: true,
      summary: {
        // Module 1 — User Management
        totalUsers: metrics.users?.totalUsers ?? 0,
        activeUsers: metrics.users?.activeUsers ?? 0,
        adminCount: metrics.users?.adminCount ?? 0,
        recentRegistrations: metrics.users?.recentRegistrations ?? 0,

        // Module 2 — CV Parsing
        uploadedCVs: metrics.cv?.totalUploaded ?? 0,
        parsedCVs: metrics.cv?.parsedCVs ?? 0,

        // Module 3 — Profile Builder
        githubConnected: metrics.users?.githubConnected ?? 0,

        // Future modules — graceful defaults (not hardcoded fake data)
        cvsGenerated: 'not_available',
        interviewsConducted: 'not_available',
        learningProgress: 'not_available',
        careerMatches: 'not_available',
      },
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch summary' });
  }
};
