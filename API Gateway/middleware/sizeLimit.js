import { CV_UPLOAD_PATH, isTaxonomyUpload, pathOf } from '../config.js';

// Rejects oversized requests by Content-Length before proxying. The body is
// never parsed here (no express.json before the proxies), so streaming is kept.
// Requests without Content-Length pass through; the services keep their own
// limits (AIServices enforces 5 MB per CV file).
//
// So the client reliably receives the 413 (instead of a connection reset while
// it is still sending), a moderately oversized body is drained and discarded;
// for absurd declared sizes the connection is closed instead of reading it.
const DRAIN_FACTOR = 4;

// Refusing an oversized upload. The decision is made at once (from Content-Length,
// or at the byte limit while streaming) and nothing more is forwarded. A client that
// is still sending cannot reliably read an early answer: Node closes a
// "Connection: close" request's socket as soon as the response is written, and the
// client then sees a reset instead of the 413. So the rest of the body is discarded
// and the 413 is sent when it ends — or, for a large remainder, after LINGER_MS /
// LINGER_MAX_BYTES, followed by closing the connection (as nginx's lingering close).
// Clients that send "Expect: 100-continue" (e.g. curl) get the 413 at once and never
// send the body (see createServer).
const LINGER_MS = 2000;
const LINGER_MAX_BYTES = 16 * 1024 * 1024;

export const refuseAfterDiscard = (req, res, body) => {
  let seen = 0;
  let answered = false;
  const answer = (close) => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    if (!res.headersSent) {
      if (close) res.set('Connection', 'close');
      res.status(413).json(body);
    }
    if (close) res.on('finish', () => req.socket?.destroy());
  };
  const timer = setTimeout(() => answer(true), LINGER_MS);
  timer.unref?.();
  req.on('data', (chunk) => {
    seen += chunk.length;
    if (seen > LINGER_MAX_BYTES) answer(true);
  });
  req.on('end', () => answer(false));
  req.on('error', () => {});
  req.resume();
};

const formatMb = (bytes) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

// The limit for a request (bytes) and its 413 body.
export const limitFor = (req, { maxBodyBytes, maxUploadBytes, maxTaxonomyUploadBytes }) => {
  if (isTaxonomyUpload(req)) {
    return { max: maxTaxonomyUploadBytes, immediate: true,
      body: { success: false, code: 'PAYLOAD_TOO_LARGE', message: `The upload is too large (limit ${formatMb(maxTaxonomyUploadBytes)}).` } };
  }
  const isUpload = pathOf(req) === CV_UPLOAD_PATH;
  const max = isUpload ? maxUploadBytes : maxBodyBytes;
  return {
    max,
    immediate: false,
    body: {
      success: false,
      code: 'PAYLOAD_TOO_LARGE',
      message: isUpload
        ? 'The file is too large. CV files must be 5 MB or smaller.'
        : `Request is too large (limit ${formatMb(max)}).`,
    },
  };
};

export const createSizeLimit = (config) => (req, res, next) => {
  const length = Number.parseInt(req.get('content-length'), 10);
  if (!Number.isFinite(length)) return next();

  const { max, immediate, body } = limitFor(req, config);
  if (length <= max) return next();

  // The taxonomy upload is refused from Content-Length alone, before reading the body
  // and without forwarding anything; at most LINGER_MAX_BYTES are discarded so the
  // client receives the 413 (draining a dataset upload would mean receiving it all).
  if (immediate) {
    refuseAfterDiscard(req, res, body);
    return undefined;
  }

  if (length > max * DRAIN_FACTOR) {
    res.set('Connection', 'close');
    res.status(413).json(body);
    return undefined;
  }

  // Discard the body, then answer once it has been fully received.
  req.on('end', () => {
    if (!res.headersSent) res.status(413).json(body);
  });
  req.on('error', () => {});
  req.resume();
  return undefined;
};
