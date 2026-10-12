// Logging is fire-and-forget, so tests poll for the stored document.
export const waitFor = async (fn, { timeout = 3000, interval = 25 } = {}) => {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) return value;
    await new Promise((r) => setTimeout(r, interval));
  }
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
