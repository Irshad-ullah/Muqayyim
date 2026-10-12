import { randomUUID } from 'crypto';

// Every request gets an X-Request-Id: a valid incoming id is kept (so callers
// can correlate), anything else is replaced with a fresh UUID v4. The id is
// forwarded to the target service and set on the response.
const VALID_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

export const isValidRequestId = (value) => typeof value === 'string' && VALID_REQUEST_ID.test(value);

export const requestId = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const id = isValidRequestId(incoming) ? incoming : randomUUID();
  req.requestId = id;
  req.headers['x-request-id'] = id; // forwarded by the proxy
  res.setHeader('X-Request-Id', id);
  next();
};
