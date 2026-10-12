import { readFileSync } from 'fs';

// Profile and CV-generator limits (FR5.x / FR6.x). The JSON file is the single
// source of truth: the frontend copy (frontend/src/constants/profileLimits.js)
// and AIServices (app/core/profile_limits.py) are checked against it by
// parity tests, so change the JSON first and then the copies.
const deepFreeze = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
  return Object.freeze(o);
};

export const LIMITS = deepFreeze(
  JSON.parse(readFileSync(new URL('./profileLimits.json', import.meta.url), 'utf8')),
);

export const MAX_ENTRIES = LIMITS.maxEntries;
export const CV_LIMITS = LIMITS.cv;
export default LIMITS;
