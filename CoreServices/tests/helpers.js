import mongoose from 'mongoose';

// Tests run against a throwaway database on the local MongoDB (dropped afterwards).
export const TEST_DB = 'core_db_test';
export const INTERNAL_KEY = 'test-internal-key-0123456789';

process.env.INTERNAL_API_KEY = INTERNAL_KEY;
process.env.JWT_SECRET = process.env.JWT_SECRET_TEST || 'test-jwt-secret';
// Never reach a real AIServices from tests (skill-embedding pushes etc.):
// a closed port, and no retry delays. Tests that need AI start a stub server.
process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
process.env.EMBEDDING_SYNC_RETRY_DELAYS_MS = '0,0,0';

export const connectTestDb = () =>
  mongoose.connect(process.env.MONGODB_URL || 'mongodb://localhost:27017', { dbName: TEST_DB });

export const dropTestDb = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};
