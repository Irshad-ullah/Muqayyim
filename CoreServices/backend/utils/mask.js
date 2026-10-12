// Masking for anything written to the error / security logs.
// Never log request bodies, headers or file contents — callers pass only
// error messages, stacks and small detail objects, which are cleaned here.

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|api[-_]?key|internal[-_]?key|cookie/i;
export const REDACTED = '[REDACTED]';

const STRING_RULES = [
  // JWTs and other three-segment base64url tokens
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]'],
  [/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  // Authorization header values
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]'],
  // Credentials inside URLs: scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  // key=value / key: value pairs for sensitive keys (e.g. "password=hunter2")
  [/\b(pass(?:word)?|pwd|token|secret|api[-_]?key|internal[-_]?key|authorization|cookie)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, `$1$2${REDACTED}`],
];

export const maskString = (value) => {
  if (typeof value !== 'string') return value;
  return STRING_RULES.reduce((s, [re, rep]) => s.replace(re, rep), value);
};

export const truncate = (value, max) =>
  typeof value === 'string' && value.length > max ? `${value.slice(0, max - 1)}…` : value;

// Deep copy with sensitive keys redacted and strings masked. Depth-limited and
// cycle-safe so a strange object can never break logging.
export const maskDeep = (value, depth = 0, seen = new WeakSet()) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return maskString(value);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (depth > 8 || seen.has(value)) return '[Truncated]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => maskDeep(v, depth + 1, seen));
  const out = {};
  for (const [k, v] of Object.entries(value).slice(0, 100)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : maskDeep(v, depth + 1, seen);
  }
  return out;
};

export const MAX_MESSAGE = 1000;
export const MAX_STACK = 4000;
export const maskMessage = (m) => truncate(maskString(String(m ?? '')), MAX_MESSAGE);
export const maskStack = (s) => (s ? truncate(maskString(String(s)), MAX_STACK) : undefined);
