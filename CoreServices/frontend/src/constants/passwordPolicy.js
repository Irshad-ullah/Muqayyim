// Password policy (SRS FR2.3) — mirrors CoreServices/backend/utils/passwordPolicy.js.
// CoreServices/tests/passwordPolicy.test.js fails if the two drift apart.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

// Checklist shown under password fields (also used for validation).
export const PASSWORD_CHECKS = [
  {
    id: 'length',
    label: `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`,
    message: `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`,
    test: (p) => p.length >= PASSWORD_MIN_LENGTH && p.length <= PASSWORD_MAX_LENGTH,
  },
  {
    id: 'letter',
    label: 'Contains a letter',
    message: 'Password must contain at least one letter',
    test: (p) => /[A-Za-z]/.test(p),
  },
  {
    id: 'digit',
    label: 'Contains a number',
    message: 'Password must contain at least one number',
    test: (p) => /\d/.test(p),
  },
];

export const validatePassword = (password) => {
  if (typeof password !== 'string') return { valid: false, errors: ['Password is required'] };
  const errors = PASSWORD_CHECKS.filter((c) => !c.test(password)).map((c) => c.message);
  return { valid: errors.length === 0, errors };
};
