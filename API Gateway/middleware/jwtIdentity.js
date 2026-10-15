import crypto from 'node:crypto';

// The user id from a VALID token, for per-user rate limiting only (09c Part 7).
// The gateway still does not authorise anything: Core and AI verify tokens and the
// user's live state themselves. Without JWT_SECRET (or with an invalid, expired or
// non-HS256 token) this returns null and callers fall back to the client IP.
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

export const verifiedUserId = (req, secret) => {
  if (!secret) return null;
  const match = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(req.get('authorization') || '');
  if (!match) return null;
  const [head, payload, signature] = match[1].split('.');
  try {
    if (decode(head).alg !== 'HS256') return null;
    const expected = crypto.createHmac('sha256', secret).update(`${head}.${payload}`).digest();
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const claims = decode(payload);
    const now = Date.now() / 1000;
    if (typeof claims.exp === 'number' && now >= claims.exp) return null;
    if (typeof claims.nbf === 'number' && now < claims.nbf) return null;
    const id = claims.userId ?? claims.id ?? claims.sub;
    return typeof id === 'string' && ID.test(id) ? id : null;
  } catch {
    return null;
  }
};
