import mongoose from 'mongoose';

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
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

export default connectDB;
