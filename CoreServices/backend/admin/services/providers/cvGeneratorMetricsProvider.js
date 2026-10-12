import GeneratedCv from '../../../models/GeneratedCv.js';

export class CvGeneratorMetricsProvider {
  async getMetrics() {
    const [totalGenerated, usersWithCvs] = await Promise.all([
      GeneratedCv.countDocuments(),
      GeneratedCv.distinct('userId').then((ids) => ids.length),
    ]);

    return {
      totalGenerated,
      usersWithCvs,
    };
  }
}
