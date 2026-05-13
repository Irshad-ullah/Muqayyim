import User from '../../models/User.js';

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
