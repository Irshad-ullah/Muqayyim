import { jest } from '@jest/globals';
import { INTERNAL_KEY } from './helpers.js';
import requireInternalKey from '../backend/middleware/internalAuth.js';

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};
const mockReq = (key) => ({ get: (h) => (h.toLowerCase() === 'x-internal-key' ? key : undefined) });

describe('requireInternalKey', () => {
  test('missing key → 401', () => {
    const res = mockRes();
    const next = jest.fn();
    requireInternalKey(mockReq(undefined), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('wrong key (same length) → 403', () => {
    const res = mockRes();
    const next = jest.fn();
    requireInternalKey(mockReq('x'.repeat(INTERNAL_KEY.length)), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('wrong key (different length) → 403 without throwing', () => {
    const res = mockRes();
    const next = jest.fn();
    requireInternalKey(mockReq('short'), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('correct key → next()', () => {
    const res = mockRes();
    const next = jest.fn();
    requireInternalKey(mockReq(INTERNAL_KEY), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
