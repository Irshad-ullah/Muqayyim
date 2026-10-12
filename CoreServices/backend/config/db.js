import mongoose from 'mongoose';
import { logError } from '../services/errorLogger.js';

const connectDB = async () => {
  try {
    const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017';
    // Database-per-service: CoreServices owns core_db only (AIServices uses ai_db).
    const dbName = process.env.CORE_DB_NAME || process.env.DB_NAME || 'core_db';

    await mongoose.connect(mongoUrl, {
      dbName: dbName,
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ MongoDB connected successfully');
    return mongoose.connection;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    // The DB is unavailable, so this goes to the console and (if configured) an
    // admin alert using the cached admin list; then exit as before.
    await logError({ level: 'critical', module: 'database', err: error });
    process.exit(1);
  }
};

export default connectDB;

// Losing the database after startup is critical: log (console fallback while
// disconnected) and alert admins. Registered once per process.
let watching = false;
export const watchDbConnection = () => {
  if (watching) return;
  watching = true;
  mongoose.connection.on('disconnected', () => {
    logError({ level: 'critical', module: 'database', errorType: 'MongoDisconnected', message: 'MongoDB connection lost' });
  });
  mongoose.connection.on('error', (err) => {
    logError({ level: 'critical', module: 'database', err });
  });
  mongoose.connection.on('reconnected', () => console.log('✅ MongoDB reconnected'));
};
