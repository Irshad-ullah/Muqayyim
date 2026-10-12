import crypto from 'crypto';

// Service-to-service authentication for /internal routes.
// Callers send the shared secret in `X-Internal-Key`. Never log the key.
const requireInternalKey = (req, res, next) => {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    console.error('INTERNAL_API_KEY is not configured; rejecting internal request');
    return res.status(503).json({ success: false, message: 'Internal API not configured' });
  }

  const provided = req.get('X-Internal-Key');
  if (!provided) {
    return res.status(401).json({ success: false, message: 'Missing internal API key' });
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so check length first.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ success: false, message: 'Invalid internal API key' });
  }

  return next();
};

export default requireInternalKey;
