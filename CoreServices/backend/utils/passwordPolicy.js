// Password policy (SRS FR2.3) — the single source of truth for every place a
// password is set or changed. Mirrored in frontend/src/constants/passwordPolicy.js
// (kept in sync by tests/passwordPolicy.test.js).

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_LETTER_REGEX = /[A-Za-z]/;
export const PASSWORD_DIGIT_REGEX = /\d/;

export const PASSWORD_RULES = [
  {
    id: 'length',
    message: `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`,
    test: (p) => p.length >= PASSWORD_MIN_LENGTH && p.length <= PASSWORD_MAX_LENGTH,
  },
  {
    id: 'letter',
    message: 'Password must contain at least one letter',
    test: (p) => PASSWORD_LETTER_REGEX.test(p),
  },
  {
    id: 'digit',
    message: 'Password must contain at least one number',
    test: (p) => PASSWORD_DIGIT_REGEX.test(p),
  },
];

export const validatePassword = (password) => {
  if (typeof password !== 'string') {
    return { valid: false, errors: ['Password is required'] };
  }
  const errors = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.message);
  return { valid: errors.length === 0, errors };
};

// 400 body in the API's usual shape, plus field-level detail for the UI.
export const passwordErrorResponse = (errors, field = 'password') => ({
  success: false,
  message: errors[0],
  field,
  errors: errors.map((message) => ({ field, message })),
});
