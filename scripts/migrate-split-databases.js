#!/usr/bin/env node
/**
 * Split the shared Muqayyim database into one database per service.
 *
 *   <source>.cv_parsed_data      → ai_db   (AIServices)
 *   <source>.<everything else>   → core_db (CoreServices: users, profiles,
 *                                  generatedcvs, adminlogs, systemconfigs, ...)
 *
 * Safe to re-run: documents are upserted by _id, and the source database is
 * never modified or deleted. Old status values are mapped to the shared enum.
 *
 * Usage (from the repo root; uses CoreServices' installed mongoose/dotenv and
 * reads MONGODB_URL from CoreServices/.env unless already set):
 *   node scripts/migrate-split-databases.js --dry-run
 *   node scripts/migrate-split-databases.js
 *
 * Env: MONGODB_URL, SOURCE_DB_NAME (default "muqayyim"),
 *      CORE_DB_NAME (default "core_db"), AI_DB_NAME (default "ai_db")
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

// Lives outside both services (it touches both databases); borrows CoreServices' deps.
const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'CoreServices');
const require = createRequire(path.join(coreDir, 'package.json'));
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(coreDir, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017';
const SOURCE_DB = process.env.SOURCE_DB_NAME || 'muqayyim';
const CORE_DB = process.env.CORE_DB_NAME || 'core_db';
const AI_DB = process.env.AI_DB_NAME || 'ai_db';

// Collections owned by AIServices; everything else belongs to CoreServices.
const AI_COLLECTIONS = new Set(['cv_parsed_data']);
const BATCH_SIZE = 500;

const USER_CV_STATUS = {
  'Not Uploaded': 'not_uploaded',
  Uploaded: 'uploaded',
  Processing: 'processing',
  Verified: 'verified',
};
const PARSING_STATUS = { completed: 'parsed' };

// Per-collection document transforms (old status values → shared enum).
const transforms = {
  users: (doc) => {
    if (USER_CV_STATUS[doc.cvStatus]) doc.cvStatus = USER_CV_STATUS[doc.cvStatus];
    return doc;
  },
  profiles: (doc) => {
    const s = doc.cvData?.parsingStatus;
    if (s && PARSING_STATUS[s]) doc.cvData.parsingStatus = PARSING_STATUS[s];
    return doc;
  },
  cv_parsed_data: (doc) => {
    if (PARSING_STATUS[doc.parsing_status]) doc.parsing_status = PARSING_STATUS[doc.parsing_status];
    return doc;
  },
};

const copyCollection = async (source, target, name) => {
  const transform = transforms[name] || ((d) => d);
  const total = await source.collection(name).countDocuments();
  if (DRY_RUN) {
    const existing = await target.collection(name).countDocuments().catch(() => 0);
    console.log(`  [dry-run] ${name}: ${total} docs → ${target.databaseName}.${name} (currently ${existing})`);
    return { name, total, upserted: 0, matched: 0 };
  }

  let upserted = 0;
  let matched = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const res = await target.collection(name).bulkWrite(batch, { ordered: false });
    upserted += res.upsertedCount;
    matched += res.matchedCount;
    batch = [];
  };

  for await (const doc of source.collection(name).find()) {
    batch.push({ replaceOne: { filter: { _id: doc._id }, replacement: transform(doc), upsert: true } });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  // Recreate secondary indexes (unique email, userId, ...) on the target.
  const indexes = (await source.collection(name).indexes()).filter((ix) => ix.name !== '_id_');
  for (const { key, name: ixName, v, ns, ...options } of indexes) {
    await target.collection(name).createIndex(key, { name: ixName, ...options }).catch((err) => {
      console.warn(`  ! could not create index ${ixName} on ${name}: ${err.message}`);
    });
  }

  console.log(`  ${name}: ${total} docs → ${target.databaseName}.${name} (inserted ${upserted}, updated ${matched})`);
  return { name, total, upserted, matched };
};

const main = async () => {
  if ([CORE_DB, AI_DB].includes(SOURCE_DB)) {
    throw new Error('SOURCE_DB_NAME must differ from CORE_DB_NAME and AI_DB_NAME');
  }

  const conn = await mongoose.createConnection(MONGODB_URL).asPromise();
  try {
    const client = conn.getClient();
    const source = client.db(SOURCE_DB);
    const core = client.db(CORE_DB);
    const ai = client.db(AI_DB);

    const names = (await source.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name)
      .filter((n) => !n.startsWith('system.'))
      .sort();
    if (!names.length) {
      console.log(`Source database "${SOURCE_DB}" has no collections — nothing to migrate.`);
      return;
    }

    console.log(`${DRY_RUN ? 'DRY RUN — no writes. ' : ''}Splitting "${SOURCE_DB}" → "${CORE_DB}" + "${AI_DB}"`);
    console.log(`\nCoreServices → ${CORE_DB}`);
    for (const name of names.filter((n) => !AI_COLLECTIONS.has(n))) await copyCollection(source, core, name);
    console.log(`\nAIServices → ${AI_DB}`);
    for (const name of names.filter((n) => AI_COLLECTIONS.has(n))) await copyCollection(source, ai, name);

    console.log(`\nDone. Source database "${SOURCE_DB}" was not modified.`);
  } finally {
    await conn.close();
  }
};

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
