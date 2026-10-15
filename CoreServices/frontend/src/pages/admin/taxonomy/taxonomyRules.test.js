import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backgroundWarning,
  checkUploadFiles,
  isRunning,
  lockLabel,
  publishState,
  taxonomyError,
} from './taxonomyRules.js';

const previewed = (checks = { background_warning: false }) => ({ job_id: 'j1', status: 'previewed', checks });
const warned = previewed({
  background_warning: true,
  background: { check: { chef_pooled_pct: 9.5, web_pooled_pct: 12.0, chef_to_web: 0.79, criteria: 'chef <= 5.0% and chef <= 0.5 x web', passed: false } },
});
const httpError = (status, data = {}, headers = {}) => ({ response: { status, data, headers } });

test('publish: only a previewed job, nothing running, warning acknowledged', () => {
  assert.equal(publishState({ job: null }).enabled, false);
  for (const status of ['uploaded', 'validating', 'validated', 'previewing', 'publishing', 'published', 'failed', 'cancelled']) {
    assert.equal(publishState({ job: { status } }).enabled, false, status);
  }
  assert.deepEqual(publishState({ job: previewed() }), { enabled: true, reason: null });
  assert.equal(publishState({ job: previewed(), lock: { owner: 'edit:x' } }).enabled, false);
  assert.equal(publishState({ job: previewed(), busy: true }).enabled, false);
  const blocked = publishState({ job: warned, acknowledged: false });
  assert.equal(blocked.enabled, false);
  assert.match(blocked.reason, /I understand/);
  assert.equal(publishState({ job: warned, acknowledged: true }).enabled, true);
  // The acknowledgement never overrides the lock.
  assert.equal(publishState({ job: warned, acknowledged: true, lock: { owner: 'job:j2' } }).enabled, false);
});

test('background warning: rates, or the reason the check could not run', () => {
  assert.equal(backgroundWarning(previewed()), null);
  assert.deepEqual(backgroundWarning(warned), {
    unavailable: false, chef: 9.5, web: 12.0, ratio: 0.79, criteria: 'chef <= 5.0% and chef <= 0.5 x web',
  });
  assert.deepEqual(backgroundWarning(previewed({ background_warning: true, background: { error: 'model not ready' } })), {
    unavailable: true, error: 'model not ready',
  });
});

test('running states are the ones that are polled', () => {
  assert.equal(isRunning({ status: 'uploaded' }), true); // validation starts right after the upload
  assert.equal(isRunning({ status: 'validating' }), true);
  assert.equal(isRunning({ status: 'previewing' }), true);
  assert.equal(isRunning({ status: 'publishing' }), true);
  assert.equal(isRunning({ status: 'previewed' }), false);
  assert.equal(isRunning(null), false);
});

test('lock banner names the operation and the admin', () => {
  assert.equal(lockLabel(null), null);
  assert.deepEqual(lockLabel({ owner: 'job:abc', actor: 'admin-1', acquired_at: '2026-10-16T10:00:00Z' }), {
    operation: 'Publishing an import', actor: 'admin-1', since: '2026-10-16T10:00:00Z',
  });
  assert.equal(lockLabel({ owner: 'edit:skill "Kafka": description', actor: 'a' }).operation, 'Editing skill "Kafka": description');
  assert.equal(lockLabel({ owner: 'restore:r1' }).operation, 'Restoring a snapshot');
  assert.equal(lockLabel({ owner: 'restore:r1' }).actor, 'unknown');
  assert.equal(lockLabel({ owner: 'recovery:j1', actor: 'system' }).operation, 'Recovering after a restart');
});

test('error messages for 403 / 409 / 413 / 422 / 429 / 503 / 504 and no connection', () => {
  assert.match(taxonomyError(httpError(403, { code: 'FORBIDDEN' })).message, /Only administrators/);
  const busy = taxonomyError(httpError(409, { code: 'TAXONOMY_BUSY', lock: { owner: 'job:j9', actor: 'admin-2' } }));
  assert.equal(busy.title, 'Taxonomy busy');
  assert.match(busy.message, /Publishing an import \(by admin-2\)/);
  assert.match(taxonomyError(httpError(409, { code: 'LIVE_DATA_CHANGED' })).message, /Run the preview again/);
  assert.equal(taxonomyError(httpError(409, { code: 'SEED_READ_ONLY', message: 'Seed descriptions are read-only' })).title, 'Read-only skill');
  assert.match(taxonomyError(httpError(413, { code: 'PAYLOAD_TOO_LARGE' })).message, /larger than 100 MB/);
  const rejected = taxonomyError(httpError(422, { code: 'UPLOAD_REJECTED', message: 'Unsafe ZIP', errors: ['a/../b.csv: path'] }));
  assert.equal(rejected.message, 'Unsafe ZIP');
  assert.deepEqual(rejected.details, ['a/../b.csv: path']);
  assert.match(taxonomyError(httpError(422, { code: 'BACKGROUND_ACK_REQUIRED' })).message, /I understand/);
  assert.match(taxonomyError(httpError(429, { code: 'RATE_LIMITED' }, { 'retry-after': '600' })).message, /10 minutes/);
  assert.match(taxonomyError(httpError(429, { code: 'RATE_LIMITED' })).message, /later/);
  assert.match(taxonomyError(httpError(503, { code: 'TAXONOMY_UNAVAILABLE' })).message, /Nothing was changed/);
  assert.match(taxonomyError(httpError(504, { code: 'TAXONOMY_TIMEOUT' })).message, /may still have started/);
  assert.equal(taxonomyError(new Error('Network Error')).title, 'No connection');
});

test('upload files are checked before sending', () => {
  const mb = 1024 * 1024;
  assert.match(checkUploadFiles([]), /Choose/);
  assert.match(checkUploadFiles([{ name: 'notes.txt', size: 10 }]), /Only .zip and .csv/);
  assert.match(checkUploadFiles([{ name: 'big.zip', size: 101 * mb }]), /limit is 100 MB/);
  assert.equal(checkUploadFiles([{ name: 'occupation_data.csv', size: mb }, { name: 'job_titles.CSV', size: mb }]), null);
});
