import { jest } from '@jest/globals';

// Offline test doubles: no DNS lookups for email validation, no real mail.
// Must be imported before app.js.
export const mail = {
  sendEmail: jest.fn(async () => true),
  sendPasswordResetEmail: jest.fn(async () => true),
  sendPasswordChangedEmail: jest.fn(async () => true),
};

jest.unstable_mockModule('../backend/utils/emailValidator.js', () => ({
  validateEmail: async () => ({ valid: true }),
}));
jest.unstable_mockModule('../backend/utils/emailService.js', () => mail);
