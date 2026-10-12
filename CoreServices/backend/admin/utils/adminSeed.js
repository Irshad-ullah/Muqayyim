import User from '../../models/User.js';
import { validatePassword, PASSWORD_MIN_LENGTH } from '../../utils/passwordPolicy.js';

// Runs once at startup. Reads ADMIN_SEED_EMAIL + ADMIN_SEED_PASSWORD from .env.
// Safe to leave in production: skips if the admin already exists.
export const seedAdmin = async () => {
  const email = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;
  const name = process.env.ADMIN_SEED_NAME || 'System Admin';

  if (!email || !password) {
    // Not configured — normal in production after first boot
    return;
  }

  try {
    const existing = await User.findOne({ email: email.toLowerCase() });

    if (existing) {
      if (existing.role !== 'Admin') {
        existing.role = 'Admin';
        await existing.save();
        console.log(`[AdminSeed] Promoted ${email} to Admin`);
      }
      // Already an admin — nothing to do
      return;
    }

    // The policy applies only when the seed creates an account; existing
    // admins (handled above) keep working with whatever password they have.
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      console.error(
        `[AdminSeed] Not creating ${email}: ADMIN_SEED_PASSWORD does not meet the password policy ` +
          `(${passwordCheck.errors.join('; ')}). Use at least ${PASSWORD_MIN_LENGTH} characters ` +
          'with at least one letter and one number, e.g. a passphrase like "Muqayyim-Admin-2026".',
      );
      return;
    }

    await User.create({
      name,
      email: email.toLowerCase(),
      password,
      role: 'Admin',
    });

    console.log(`[AdminSeed] Admin account created: ${email}`);
  } catch (err) {
    console.error('[AdminSeed] Failed:', err.message);
  }
};
