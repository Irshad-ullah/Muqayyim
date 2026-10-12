import mongoose from 'mongoose';

const positiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const logRetentionDays = () => positiveInt(process.env.LOG_RETENTION_DAYS, 30);
export const alertsEnabled = () => process.env.ALERTS_ENABLED !== 'false';
export const alertThrottleMs = () => positiveInt(process.env.ALERT_THROTTLE_MINUTES, 15) * 60 * 1000;

const TTL_INDEX = 'timestamp_ttl';

// Creates (or updates in place with collMod) the TTL index that expires log
// entries after LOG_RETENTION_DAYS. Safe to run on every startup.
export const ensureTtlIndex = async (collectionName, days = logRetentionDays()) => {
  const db = mongoose.connection.db;
  const seconds = days * 24 * 60 * 60;
  const collections = await db.listCollections({ name: collectionName }).toArray();
  if (!collections.length) await db.createCollection(collectionName);
  const coll = db.collection(collectionName);
  const existing = (await coll.indexes()).find((ix) => ix.name === TTL_INDEX);
  if (!existing) {
    await coll.createIndex({ timestamp: 1 }, { name: TTL_INDEX, expireAfterSeconds: seconds });
  } else if (existing.expireAfterSeconds !== seconds) {
    await db.command({ collMod: collectionName, index: { name: TTL_INDEX, expireAfterSeconds: seconds } });
  }
  return seconds;
};

export const ensureLogIndexes = async () => {
  try {
    const { default: ErrorLog } = await import('../models/ErrorLog.js');
    const { default: SecurityEvent } = await import('../models/SecurityEvent.js');
    await Promise.all([ErrorLog.init(), SecurityEvent.init()]);
    await Promise.all([ensureTtlIndex('error_logs'), ensureTtlIndex('security_events')]);
  } catch (err) {
    console.error('[ErrorLog] Could not ensure log indexes:', err.message);
  }
};
