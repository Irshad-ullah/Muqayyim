// Rate-limit hits are not logged one by one. When a single IP hits limits more
// than `threshold` times within `windowMs`, one RATE_LIMIT_SPIKE warning is
// reported; the next one for that IP only after the window has passed.
// In-memory, per gateway instance (like the rate-limit store).

export const createSpikeDetector = ({ threshold = 20, windowMs = 10 * 60 * 1000, onSpike, now = () => Date.now() } = {}) => {
  const hits = new Map(); // ip → { times: number[], alertedAt: number }

  const record = (ip, details = {}) => {
    const t = now();
    const state = hits.get(ip) || { times: [], alertedAt: -Infinity };
    state.times = state.times.filter((x) => t - x < windowMs);
    state.times.push(t);
    hits.set(ip, state);

    if (state.times.length > threshold && t - state.alertedAt >= windowMs) {
      state.alertedAt = t;
      onSpike?.({ ip, count: state.times.length, windowMs, ...details });
    }
    // Keep memory bounded.
    if (hits.size > 10000) {
      for (const [key, value] of hits) {
        if (!value.times.length || t - value.times.at(-1) >= windowMs) hits.delete(key);
      }
    }
  };

  return { record };
};
