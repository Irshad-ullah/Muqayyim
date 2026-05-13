import User from '../../../models/User.js';
import Profile from '../../../models/Profile.js';

export class UserMetricsProvider {
  async getMetrics() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      adminCount,
      jobSeekerCount,
      recentRegistrations,
      githubConnected,
      activeUsers,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'Admin' }),
      User.countDocuments({ role: 'JobSeeker' }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Profile.countDocuments({ 'githubData.username': { $ne: '' } }),
      User.countDocuments({ isActive: { $ne: false } }),
    ]);

    return {
      totalUsers,
      adminCount,
      jobSeekerCount,
      recentRegistrations,
      githubConnected,
      activeUsers,
    };
  }
}
