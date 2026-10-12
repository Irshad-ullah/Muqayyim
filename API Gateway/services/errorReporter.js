// Sends gateway error-log entries to CoreServices (POST /internal/logs).
// Fire-and-forget and batched: entries are queued and flushed when the batch
// is full or after a short delay. If Core is unreachable the entry is written
// to the console only. Never logs bodies, headers or the internal key.

const MAX_BATCH = 50; // Core accepts at most 50 per request

export const createErrorReporter = ({
  coreUrl,
  internalKey,
  batchSize = 20,
  flushMs = 1000,
  timeoutMs = 2000,
  fetchImpl = globalThis.fetch,
} = {}) => {
  let queue = [];
  let timer = null;

  const consoleFallback = (entries, reason) => {
    for (const e of entries) {
      console.error(`[ErrorLog:${reason}] ${JSON.stringify(e)}`);
    }
  };

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!queue.length) return;
    const batch = queue.splice(0, Math.min(batchSize, MAX_BATCH));
    if (queue.length) timer = setTimeout(flush, 0);

    if (!coreUrl || !internalKey) {
      consoleFallback(batch, 'not-configured');
      return;
    }
    try {
      const res = await fetchImpl(`${coreUrl.replace(/\/$/, '')}/internal/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Key': internalKey },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) consoleFallback(batch, `core-http-${res.status}`);
    } catch (err) {
      consoleFallback(batch, `core-unreachable ${err.name}`);
    }
  };

  const report = (entry) => {
    try {
      queue.push({ timestamp: new Date().toISOString(), ...entry });
      if (queue.length >= batchSize) {
        flush().catch(() => {});
      } else if (!timer) {
        timer = setTimeout(() => flush().catch(() => {}), flushMs);
        timer.unref?.();
      }
    } catch {
      // Reporting must never affect the request.
    }
  };

  return { report, flush, pending: () => queue.length };
};
