// Security event log. Console for now; switch the sink here (e.g. a database
// collection) without touching callers. Never pass passwords or tokens.
export const logSecurityEvent = (event, details = {}) => {
  const entry = { event, at: new Date().toISOString(), ...details };
  console.warn(`[Security] ${event}`, JSON.stringify(entry));
  return entry;
};
