import {
  validatePassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '../backend/utils/passwordPolicy.js';
import * as frontendPolicy from '../frontend/src/constants/passwordPolicy.js';

describe('validatePassword', () => {
  test.each([
    ['abc12', 'too short'],
    ['abcdefgh', 'no digit'],
    ['12345678', 'no letter'],
    ['', 'empty'],
    ['a1'.repeat(65), 'too long (130)'],
  ])('%s is invalid (%s)', (pw) => {
    const result = validatePassword(pw);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test.each(['abcd1234', 'Passw0rd!', `a${'1'.repeat(127)}`])('%s is valid', (pw) => {
    expect(validatePassword(pw)).toEqual({ valid: true, errors: [] });
  });

  test('non-string input is invalid', () => {
    expect(validatePassword(undefined).valid).toBe(false);
    expect(validatePassword(12345678).valid).toBe(false);
    expect(validatePassword(null).valid).toBe(false);
  });

  test('reports every failing rule', () => {
    expect(validatePassword('abc').errors).toHaveLength(2); // length + digit
  });

  test('constants match the SRS (8–128)', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });
});

describe('frontend policy mirrors the backend', () => {
  const samples = ['', 'abc12', 'abcdefgh', '12345678', 'abcd1234', 'Passw0rd!', 'a1'.repeat(64), 'a1'.repeat(65), 'ÄÖÜ12345', '        1a'];

  test('same constants', () => {
    expect(frontendPolicy.PASSWORD_MIN_LENGTH).toBe(PASSWORD_MIN_LENGTH);
    expect(frontendPolicy.PASSWORD_MAX_LENGTH).toBe(PASSWORD_MAX_LENGTH);
  });

  test.each(samples)('same verdict for %j', (pw) => {
    expect(frontendPolicy.validatePassword(pw).valid).toBe(validatePassword(pw).valid);
  });
});
