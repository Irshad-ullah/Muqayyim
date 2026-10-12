import mongoose from 'mongoose';

// Tests run against a throwaway database on the local MongoDB (dropped afterwards).
export const TEST_DB = 'core_db_test';
export const INTERNAL_KEY = 'test-internal-key-0123456789';

process.env.INTERNAL_API_KEY = INTERNAL_KEY;
process.env.JWT_SECRET = process.env.JWT_SECRET_TEST || 'test-jwt-secret';

export const connectTestDb = () =>
  mongoose.connect(process.env.MONGODB_URL || 'mongodb://localhost:27017', { dbName: TEST_DB });

export const dropTestDb = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};
