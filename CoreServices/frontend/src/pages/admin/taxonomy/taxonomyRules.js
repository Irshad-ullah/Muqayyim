// Framework-free rules for the admin taxonomy screens (unit-tested with `node --test`):
// job states, the publish button, the lock banner and the error messages.

// 'uploaded' is included: validation starts in the background right after the upload.
export const RUNNING_STATUSES = ['uploaded', 'validating', 'previewing', 'publishing'];
export const FINAL_STATUSES = ['published', 'failed', 'rolled_back', 'cancelled'];
export const MAX_UPLOAD_MB = 100;

export const isRunning = (job) => Boolean(job && RUNNING_STATUSES.includes(job.status));
export const isRestoring = (restore) => restore?.status === 'restoring';

export const STATUS_LABELS = {
  uploaded: 'Uploaded',
  validating: 'Validating',
  validated: 'Validated',
  previewing: 'Building preview',
  previewed: 'Ready to publish',
  publishing: 'Publishing',
  published: 'Published',
  failed: 'Failed',
  rolled_back: 'Rolled back',
  cancelled: 'Cancelled',
  restoring: 'Restoring',
  restored: 'Restored',
};

export const SOURCE_LABELS = { onet: 'O*NET', esco: 'ESCO', manual: 'Manual' };

// "job:<id>" / "edit:<what>" / "restore:<id>" / "recovery:…" / "cli:<id>" → words for the lock banner.
export const lockLabel = (lock) => {
  if (!lock) return null;
  const owner = String(lock.owner || '');
  const [kind, ...rest] = owner.split(':');
  const what = rest.join(':');
  const operation =
    {
      job: 'Publishing an import',
      cli: 'Publishing an import from the command line',
      edit: `Editing ${what || 'the taxonomy'}`,
      restore: 'Restoring a snapshot',
      recovery: 'Recovering after a restart',
    }[kind] || owner || 'An operation';
  const actor = lock.actor || 'unknown';
  return { operation, actor, since: lock.acquired_at || null };
};

// Publish button: enabled only for a previewed job, with nothing else running, and with the
// background-check warning (if any) acknowledged.
export const publishState = ({ job, lock, acknowledged, busy }) => {
  if (!job) return { enabled: false, reason: 'Select a job' };
  if (job.status !== 'previewed') return { enabled: false, reason: 'Only a previewed job can be published' };
  if (lock) return { enabled: false, reason: 'Another taxonomy operation is running' };
  if (busy) return { enabled: false, reason: 'Please wait…' };
  if (job.checks?.background_warning && !acknowledged) {
    return { enabled: false, reason: 'Tick “I understand” under the background-check warning first' };
  }
  return { enabled: true, reason: null };
};

// The background check of a previewed job → what the amber warning shows (null when it passed).
export const backgroundWarning = (job) => {
  const checks = job?.checks;
  if (!checks?.background_warning) return null;
  const bg = checks.background || {};
  if (bg.error) return { unavailable: true, error: bg.error };
  const check = bg.check || {};
  return {
    unavailable: false,
    chef: check.chef_pooled_pct,
    web: check.web_pooled_pct,
    ratio: check.chef_to_web,
    criteria: check.criteria,
  };
};

const minutes = (seconds) => {
  const n = Math.max(1, Math.ceil(Number(seconds) / 60));
  return `${n} minute${n === 1 ? '' : 's'}`;
};

// An axios error (or anything thrown) → { title, message, details } for an inline error box.
export const taxonomyError = (error) => {
  const response = error?.response;
  if (!response) {
    return { title: 'No connection', message: 'Could not reach the server. Check your connection and try again.', details: [] };
  }
  const { status } = response;
  const data = response.data || {};
  const code = data.code;
  const details = Array.isArray(data.errors) ? data.errors.map(String) : [];
  const server = typeof data.message === 'string' ? data.message : '';

  if (status === 403) {
    return { title: 'Not allowed', message: 'Only administrators can view or change the profession and skill taxonomy.', details };
  }
  if (status === 409) {
    if (code === 'TAXONOMY_BUSY') {
      const held = lockLabel(data.lock);
      return {
        title: 'Taxonomy busy',
        message: held
          ? `${held.operation} (by ${held.actor}) is still running. Wait for it to finish, then try again.`
          : 'Another taxonomy operation is still running. Wait for it to finish, then try again.',
        details,
      };
    }
    if (code === 'LIVE_DATA_CHANGED') {
      return { title: 'Preview out of date', message: 'The live data changed after this preview. Run the preview again before publishing.', details };
    }
    if (code === 'SEED_READ_ONLY') {
      return { title: 'Read-only skill', message: server || 'This is one of the benchmark seed descriptions, which cannot be changed.', details };
    }
    if (code === 'JOB_STATE') {
      return { title: 'Not possible now', message: server || `This job is ${STATUS_LABELS[data.job_status] || data.job_status}.`, details };
    }
    return { title: 'Conflict', message: server || 'The request conflicts with the current state. Refresh and try again.', details };
  }
  if (status === 413) {
    return {
      title: 'Upload too large',
      message: `The upload is larger than ${MAX_UPLOAD_MB} MB. Upload the ESCO ZIP, or only the required CSV files.`,
      details,
    };
  }
  if (status === 422) {
    if (code === 'BACKGROUND_ACK_REQUIRED') {
      return { title: 'Confirmation needed', message: 'The background check did not pass. Tick “I understand” to publish anyway.', details };
    }
    return { title: 'Not accepted', message: server || 'The request was rejected. Check the details below.', details };
  }
  if (status === 429) {
    const retry = response.headers?.['retry-after'];
    return {
      title: 'Too many requests',
      message: `Publish and restore are limited to a few per 15 minutes.${retry ? ` Try again in ${minutes(retry)}.` : ' Try again later.'}`,
      details,
    };
  }
  if (status === 503) {
    return { title: 'Service unavailable', message: 'The AI service is not reachable right now. Nothing was changed; try again shortly.', details };
  }
  if (status === 504) {
    return {
      title: 'No answer in time',
      message: 'The AI service took too long to answer. The operation may still have started: check the job list or History before retrying.',
      details,
    };
  }
  if (status === 404) return { title: 'Not found', message: server || 'It no longer exists. Refresh the list.', details };
  if (status === 400) return { title: 'Invalid request', message: server || 'Check the values and try again.', details };
  return { title: 'Something went wrong', message: server || `The request failed (HTTP ${status}).`, details };
};

export const formatTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

export const formatBytes = (bytes) => {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

// Client-side check before an upload starts (the server checks again).
export const checkUploadFiles = (files) => {
  const list = Array.from(files || []);
  if (list.length === 0) return 'Choose one ZIP file or the CSV files.';
  const bad = list.filter((f) => !/\.(zip|csv)$/i.test(f.name));
  if (bad.length) return `Only .zip and .csv files are accepted (${bad.map((f) => f.name).join(', ')}).`;
  const total = list.reduce((sum, f) => sum + (f.size || 0), 0);
  if (total > MAX_UPLOAD_MB * 1024 * 1024) {
    return `The files add up to ${formatBytes(total)}; the limit is ${MAX_UPLOAD_MB} MB. Upload the ESCO ZIP, or only the required CSV files.`;
  }
  return null;
};
