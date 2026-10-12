// Parses TRUST_PROXY into an Express "trust proxy" value.
//   unset            → 'loopback' (local API Gateway on the same machine)
//   true / false     → booleans
//   a number (e.g. 1) → trust that many proxy hops (typical on Railway/Render)
//   anything else    → passed through (e.g. "loopback, 10.0.0.0/8")
export const parseTrustProxy = (value) => {
  if (value === undefined || value === '') return 'loopback';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
};
