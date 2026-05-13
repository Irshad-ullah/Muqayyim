import { UserMetricsProvider } from './providers/userMetricsProvider.js';
import { CvMetricsProvider } from './providers/cvMetricsProvider.js';

// Lightweight provider registry — future modules register themselves here
// without any changes to this aggregator.
//
// Pattern: each provider implements async getMetrics() → plain object.
// To add a new module's metrics:
//   import { MyProvider } from './providers/myProvider.js';
//   metricsAggregator.register('myModule', new MyProvider());
class MetricsAggregator {
  constructor() {
    this._providers = new Map();
    this.register('users', new UserMetricsProvider());
    this.register('cv', new CvMetricsProvider());
  }

  register(key, provider) {
    this._providers.set(key, provider);
    return this; // fluent
  }

  unregister(key) {
    this._providers.delete(key);
    return this;
  }

  registeredKeys() {
    return [...this._providers.keys()];
  }

  // Aggregate all providers (or a subset via optional keys array).
  // Provider failures are isolated — one broken provider never fails the response.
  async aggregate(keys = null) {
    const targetKeys = keys
      ? keys.filter((k) => this._providers.has(k))
      : [...this._providers.keys()];

    const results = {};

    await Promise.all(
      targetKeys.map(async (key) => {
        try {
          results[key] = await this._providers.get(key).getMetrics();
        } catch (err) {
          console.error(`[MetricsAggregator] Provider "${key}" failed:`, err.message);
          results[key] = { error: 'unavailable', message: err.message };
        }
      })
    );

    return results;
  }
}

// Singleton — shared across the process lifetime.
export const metricsAggregator = new MetricsAggregator();
