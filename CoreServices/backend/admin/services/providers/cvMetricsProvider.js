import User from '../../../models/User.js';

export class CvMetricsProvider {
  async getMetrics() {
    const [totalUploaded, parsedCVs, processingCVs, notUploaded] = await Promise.all([
      User.countDocuments({ cvStatus: { $in: ['Uploaded', 'Processing', 'Verified'] } }),
      User.countDocuments({ cvStatus: 'Verified' }),
      User.countDocuments({ cvStatus: 'Processing' }),
      User.countDocuments({ cvStatus: 'Not Uploaded' }),
    ]);

    return {
      totalUploaded,
      parsedCVs,
      processingCVs,
      notUploaded,
    };
  }
}
