// Shared helpers for duplicate-email handling (409).
export const EMAIL_IN_USE_MESSAGE = 'Email already in use';

export const normalizeEmail = (email) =>
  typeof email === 'string' ? email.trim().toLowerCase() : '';

export const isDuplicateKeyError = (error) => error?.code === 11000;

export const emailInUse = (res) =>
  res.status(409).json({ success: false, message: EMAIL_IN_USE_MESSAGE, field: 'email' });
