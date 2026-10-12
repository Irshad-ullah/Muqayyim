import dotenv from 'dotenv';

dotenv.config();

const { default: connectDB } = await import('./backend/config/db.js');
const { default: app } = await import('./app.js');
const { seedAdmin } = await import('./backend/admin/utils/adminSeed.js');

// Connect to MongoDB
connectDB().then(() => seedAdmin());

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Auth Service running on port ${PORT}`);
  console.log(`📊 MongoDB: ${process.env.MONGODB_URL} (db: ${process.env.CORE_DB_NAME || process.env.DB_NAME || 'core_db'})`);
});
