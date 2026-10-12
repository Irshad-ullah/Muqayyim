#!/usr/bin/env node
/**
 * Report stored profiles (and saved CVs) that break the current validation
 * rules (FR5.x / FR6.x). READ-ONLY: nothing is written, fixed or deleted.
 *
 * Existing documents keep loading — the rules apply when they are next saved —
 * so this shows what users will be asked to fix on their next save.
 * Output is counts per rule/field only; no names, emails or other content.
 *
 * Usage (from the repo root; uses CoreServices' installed mongoose/dotenv and
 * reads MONGODB_URL / CORE_DB_NAME from CoreServices/.env unless already set):
 *   node scripts/report-invalid-profiles.js
 *   node scripts/report-invalid-profiles.js --ids     # also list document ids
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'CoreServices');
const require = createRequire(path.join(coreDir, 'package.json'));
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(coreDir, '.env') });

const { ALLOWED_FIELDS, validateSection } = await import('../CoreServices/backend/validation/profileSchemas.js');
const { validateCvPayload } = await import('../CoreServices/backend/validation/cvSchemas.js');

const SHOW_IDS = process.argv.includes('--ids');
const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017';
const CORE_DB = process.env.CORE_DB_NAME || 'core_db';

// "experience[3].endDate" → "experience[].endDate" so counts group by field.
const pattern = (field) => field.replace(/\[\d+\]/g, '[]');

const tally = () => ({ checked: 0, invalid: 0, ids: [], byField: new Map() });
const record = (t, id, errors) => {
  t.checked += 1;
  if (!errors.length) return;
  t.invalid += 1;
  t.ids.push(String(id));
  for (const { field, message } of errors) {
    const key = `${pattern(field)} — ${message.replace(/\(you have \d+\)/, '(over the limit)')}`;
    t.byField.set(key, (t.byField.get(key) || 0) + 1);
  }
};

const print = (title, t) => {
  console.log(`\n${title}: ${t.invalid} of ${t.checked} would fail validation on their next save`);
  [...t.byField.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([key, count]) => console.log(`  ${String(count).padStart(4)}  ${key}`));
  if (SHOW_IDS && t.ids.length) console.log(`  ids: ${t.ids.join(', ')}`);
};

await mongoose.connect(MONGODB_URL, { dbName: CORE_DB });
const db = mongoose.connection.db;
try {
  const profiles = tally();
  for await (const doc of db.collection('profiles').find({})) {
    const errors = ALLOWED_FIELDS.filter((key) => doc[key] !== undefined).flatMap((key) => validateSection(key, doc[key]).errors);
    record(profiles, doc._id, errors);
  }

  const cvs = tally();
  for await (const doc of db.collection('generatedcvs').find({})) {
    const result = validateCvPayload({ title: doc.title, template: doc.template, settings: doc.settings, data: doc.data });
    const errors = result.missing
      ? [{ field: 'data', message: `PROFILE_INCOMPLETE (missing: ${result.missing.join(', ')})` }]
      : result.errors || [];
    record(cvs, doc._id, errors);
  }

  console.log(`Validation report for database "${CORE_DB}" (read-only, ${new Date().toISOString()})`);
  print('Profiles', profiles);
  print('Saved CVs', cvs);
} finally {
  await mongoose.disconnect();
}
