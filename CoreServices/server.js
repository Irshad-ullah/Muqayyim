import dotenv from 'dotenv';

dotenv.config();

const { default: connectDB, watchDbConnection } = await import('./backend/config/db.js');
const { default: app } = await import('./app.js');
const { seedAdmin } = await import('./backend/admin/utils/adminSeed.js');
const { logError } = await import('./backend/services/errorLogger.js');
const { ensureLogIndexes } = await import('./backend/config/logging.js');
const { refreshAdminEmails } = await import('./backend/services/alertService.js');

// Process-level failures are critical. An uncaught exception leaves the
// process in an unknown state, so it is logged (best effort, ≤ 2 s) and the
// process exits, as Node expects.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logError({ level: 'critical', module: 'process', errorType: 'UnhandledRejection', err });
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  const exit = () => process.exit(1);
  setTimeout(exit, 2000).unref();
  logError({ level: 'critical', module: 'process', errorType: err?.name || 'UncaughtException', err }).finally(exit);
});

// Connect to MongoDB
connectDB().then(async () => {
  watchDbConnection();
  await seedAdmin();
  await ensureLogIndexes();
  await refreshAdminEmails();
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Auth Service running on port ${PORT}`);
  console.log(`📊 MongoDB: ${process.env.MONGODB_URL} (db: ${process.env.CORE_DB_NAME || process.env.DB_NAME || 'core_db'})`);
});
