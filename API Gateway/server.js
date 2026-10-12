import app, { AUTH_SERVICE_URL, CV_SERVICE_URL } from './app.js';

// Process-level failures are reported to CoreServices' error log.
const reporter = app.locals.errorReporter;
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  reporter.report({ level: 'critical', module: 'process', errorType: 'UnhandledRejection', message: err.message, stack: err.stack });
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  reporter.report({ level: 'critical', module: 'process', errorType: err?.name || 'UncaughtException', message: err?.message || String(err), stack: err?.stack });
  const exit = () => process.exit(1);
  setTimeout(exit, 2500).unref();
  reporter.flush().finally(exit);
});

const PORT = process.env.PORT || 8080;

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('🌐  MUQAYYIM API Gateway');
  console.log(`    Listening on   → http://localhost:${PORT}`);
  console.log(`    /api/auth/*    → ${AUTH_SERVICE_URL}  (Core Service)`);
  console.log(`    /api/profile/* → ${AUTH_SERVICE_URL}  (Core Service)`);
  console.log(`    /api/admin/*   → ${AUTH_SERVICE_URL}  (Core Service — Admin Panel)`);
  console.log(`    /api/generated-cvs/* → ${AUTH_SERVICE_URL}  (Core Service — CV Generator)`);
  console.log(`    /api/cv/*      → ${CV_SERVICE_URL}  (AI Service)`);
  console.log('');
});
