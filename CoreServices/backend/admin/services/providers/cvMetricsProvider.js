import User from '../../../models/User.js';
import { CV_STATUS } from '../../../constants/cvStatus.js';

export class CvMetricsProvider {
  async getMetrics() {
    const [totalUploaded, parsedCVs, verifiedCVs, processingCVs, failedCVs, notUploaded] =
      await Promise.all([
        User.countDocuments({ cvStatus: { $ne: CV_STATUS.NOT_UPLOADED } }),
        User.countDocuments({ cvStatus: { $in: [CV_STATUS.PARSED, CV_STATUS.VERIFIED] } }),
        User.countDocuments({ cvStatus: CV_STATUS.VERIFIED }),
        User.countDocuments({ cvStatus: CV_STATUS.PROCESSING }),
        User.countDocuments({ cvStatus: CV_STATUS.FAILED }),
        User.countDocuments({ cvStatus: CV_STATUS.NOT_UPLOADED }),
      ]);

    return {
      totalUploaded,
      parsedCVs,
      verifiedCVs,
      processingCVs,
      failedCVs,
      notUploaded,
    };
  }
}
