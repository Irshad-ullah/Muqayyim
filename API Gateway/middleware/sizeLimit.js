import { CV_UPLOAD_PATH, pathOf } from '../config.js';

// Rejects oversized requests by Content-Length before proxying. The body is
// never parsed here (no express.json before the proxies), so streaming is kept.
// Requests without Content-Length pass through; the services keep their own
// limits (AIServices enforces 5 MB per CV file).
//
// So the client reliably receives the 413 (instead of a connection reset while
// it is still sending), a moderately oversized body is drained and discarded;
// for absurd declared sizes the connection is closed instead of reading it.
const DRAIN_FACTOR = 4;

const formatMb = (bytes) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

export const createSizeLimit = ({ maxBodyBytes, maxUploadBytes }) => (req, res, next) => {
  const length = Number.parseInt(req.get('content-length'), 10);
  if (!Number.isFinite(length)) return next();

  const isUpload = pathOf(req) === CV_UPLOAD_PATH;
  const max = isUpload ? maxUploadBytes : maxBodyBytes;
  if (length <= max) return next();

  const body = {
    success: false,
    code: 'PAYLOAD_TOO_LARGE',
    message: isUpload
      ? 'The file is too large. CV files must be 5 MB or smaller.'
      : `Request is too large (limit ${formatMb(max)}).`,
  };

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
