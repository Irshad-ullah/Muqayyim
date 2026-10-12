import app, { AUTH_SERVICE_URL, CV_SERVICE_URL } from './app.js';

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
