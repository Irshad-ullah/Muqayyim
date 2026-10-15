import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Eye, Send, XCircle } from 'lucide-react';
import { taxonomyService } from '../../../services/taxonomyService.js';
import { ErrorBox, Loading, Pagination, StatusBadge, btn, card } from './components.jsx';
import usePolling from './usePolling.js';
import {
  FINAL_STATUSES,
  SOURCE_LABELS,
  backgroundWarning,
  formatBytes,
  formatTime,
  isRunning,
  publishState,
  taxonomyError,
} from './taxonomyRules.js';

// Preview & publish: the import jobs, their validation, the preview diff and checks, and publishing.

export const SECTION_LABELS = {
  professions_added: 'Professions added',
  professions_removed: 'Professions removed',
  professions_changed: 'Professions changed',
  links_added: 'Required skills added',
  links_removed: 'Required skills removed',
  new_undescribed_skills: 'New skills without a description',
};

const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)} %`);

function describeItem(section, item) {
  if (section === 'new_undescribed_skills') return `${item.name} (${item.professions} profession${item.professions === 1 ? '' : 's'})`;
  if (section.startsWith('links_')) return `${item.title} → ${item.skill}${item.type ? ` (${item.type})` : ''}`;
  if (section === 'professions_changed') {
    const fields = Object.keys(item.changes || {});
    const kept = item.kept_admin_override?.length ? ` · kept admin override: ${item.kept_admin_override.join(', ')}` : '';
    return `${item.title}: ${fields.length ? fields.join(', ') : 'no dataset change'}${kept}`;
  }
  if (section === 'professions_removed') return `${item.title}${item.reason ? ` (${item.reason})` : ''}`;
  return `${item.title}${item.reactivated ? ' (reactivated)' : ''}`;
}

function DiffSection({ jobId, section, count, samples }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);

  const load = async (n) => {
    try {
      setPage(await taxonomyService.getDiff(jobId, section, n, 50));
      setError(null);
    } catch (err) {
      setError(taxonomyError(err));
    }
  };

  const rows = page ? page.data : samples || [];
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && !page && count > (samples?.length || 0)) load(1);
        }}
        disabled={count === 0}
      >
        <span className="text-slate-700">{SECTION_LABELS[section]}</span>
        <span className={`font-semibold ${count ? 'text-slate-800' : 'text-slate-400'}`}>{count}</span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <ErrorBox error={error} />
          <ul className="text-xs text-slate-600 space-y-0.5 list-disc ml-5">
            {rows.map((item, i) => (
              <li key={i}>{describeItem(section, item)}</li>
            ))}
          </ul>
          {page && <Pagination pagination={page.pagination} onPage={load} />}
        </div>
      )}
    </div>
  );
}

function BackgroundWarning({ job, acknowledged, onAcknowledge, disabled }) {
  const warning = backgroundWarning(job);
  if (!warning) return null;
  return (
    <div data-testid="background-warning" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-2">
      <p className="font-semibold flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" /> The background credit check did not pass on the new data
      </p>
      {warning.unavailable ? (
        <p>The check could not run: {warning.error}</p>
      ) : (
        <p>
          An unrelated profile (chef) would get related-skill credit for <strong>{pct(warning.chef)}</strong> of role skills, against{' '}
          <strong>{pct(warning.web)}</strong> for a related profile (web developer). Required: {warning.criteria}.
        </p>
      )}
      <p>Publishing anyway may make career matching credit unrelated skills.</p>
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={acknowledged} disabled={disabled} onChange={(e) => onAcknowledge(e.target.checked)} />
        I understand and want to publish anyway
      </label>
    </div>
  );
}

function ChecksSummary({ checks }) {
  if (!checks) return null;
  const staged = checks.coverage?.coverage?.overall;
  const live = checks.coverage_live?.coverage?.overall;
  const bg = checks.background?.check;
  return (
    <div className="grid md:grid-cols-2 gap-3 text-sm">
      <div className="rounded-lg bg-slate-50 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Description coverage (distinct role skills)</p>
        <p className="text-slate-800">
          Live {pct(live?.distinct_described_pct)} → new {pct(staged?.distinct_described_pct)}
        </p>
      </div>
      <div className="rounded-lg bg-slate-50 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Background credit check</p>
        <p className="text-slate-800 flex items-center gap-1.5">
          {bg ? (
            <>
              {bg.passed ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />}
              chef {pct(bg.chef_pooled_pct)} · web {pct(bg.web_pooled_pct)} — {bg.passed ? 'passed' : 'not passed'}
            </>
          ) : (
            'not available'
          )}
        </p>
      </div>
    </div>
  );
}

function JobDetail({ job, lock, busy, acknowledged, setAcknowledged, onPreview, onCancel, onPublish }) {
  const files = job.file_summary?.validated_files || {};
  const fileRows = Object.entries(files).filter(([name]) => !name.startsWith('_'));
  const summary = job.diff_summary;
  const publish = publishState({ job, lock, acknowledged, busy });
  const locked = Boolean(lock) || busy;
  const cancellable = ['uploaded', 'validated', 'previewed'].includes(job.status);

  return (
    <div className={`${card} p-5 space-y-4`} data-testid="job-detail">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-semibold text-slate-800">
            {SOURCE_LABELS[job.source]} · {job.dataset_version}
          </p>
          <p className="text-xs text-slate-500">
            Uploaded by {job.created_by}, {formatTime(job.created_at)} · {formatBytes(job.file_summary?.upload_bytes)}
          </p>
        </div>
        <StatusBadge status={job.status} />
      </div>
      {isRunning(job) && <p className="text-sm text-slate-600" data-testid="job-progress">{job.progress?.message || 'Working…'}</p>}

      {job.status === 'failed' && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">{job.error || 'The job failed'}</p>
          {job.validation_errors?.length > 0 && (
            <ul className="list-disc ml-5 mt-1">
              {job.validation_errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {job.status === 'rolled_back' && (
        <div role="alert" className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          Publishing failed and the live data was put back as it was. {job.error}
        </div>
      )}
      {job.status === 'published' && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900" data-testid="published-note">
          Published {formatTime(job.updated_at)}. Snapshot {job.snapshot_id} was taken first; restore it under History to undo.
        </div>
      )}

      {fileRows.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="text-left py-1">File</th>
              <th className="text-right py-1">Rows</th>
              <th className="text-right py-1">Size</th>
            </tr>
          </thead>
          <tbody>
            {fileRows.map(([name, info]) => (
              <tr key={name} className="border-t border-slate-100">
                <td className="py-1 text-slate-700">{name}</td>
                <td className="py-1 text-right">{info.rows?.toLocaleString() ?? '—'}</td>
                <td className="py-1 text-right">{formatBytes(info.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {summary && (
        <>
          <div className="rounded-lg border border-slate-200 overflow-hidden" data-testid="diff-summary">
            {Object.keys(SECTION_LABELS).map((section) => (
              <DiffSection key={section} jobId={job.job_id} section={section} count={summary.counts?.[section] ?? 0} samples={summary.samples?.[section]} />
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Active professions: {summary.active_professions?.live} → {summary.active_professions?.staged}
            {summary.kept_admin_overrides ? ` · ${summary.kept_admin_overrides} admin override(s) kept` : ''}
          </p>
          <ChecksSummary checks={job.checks} />
        </>
      )}

      {job.status === 'previewed' && (
        <BackgroundWarning job={job} acknowledged={acknowledged} onAcknowledge={setAcknowledged} disabled={locked} />
      )}

      <div className="flex flex-wrap gap-2 items-center">
        {job.status === 'validated' && (
          <button type="button" className={btn.primary} disabled={locked} onClick={onPreview}>
            <Eye className="w-4 h-4" /> Run preview
          </button>
        )}
        {job.status === 'previewed' && (
          <button type="button" className={btn.primary} disabled={!publish.enabled} onClick={onPublish} title={publish.reason || undefined}>
            <Send className="w-4 h-4" /> Publish
          </button>
        )}
        {cancellable && (
          <button type="button" className={btn.secondary} disabled={locked} onClick={onCancel}>
            <XCircle className="w-4 h-4" /> Cancel job
          </button>
        )}
        {job.status === 'previewed' && publish.reason && <span className="text-xs text-slate-500" data-testid="publish-reason">{publish.reason}</span>}
      </div>
    </div>
  );
}

export default function PreviewPublishTab({ lock, refreshLock, setLock, selectedJobId, onSelectJob }) {
  const [jobs, setJobs] = useState(null);
  const [listError, setListError] = useState(null);
  const [job, setJob] = useState(null);
  const jobRef = useRef(null); // the job last shown, to notice when a running job finishes
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const res = await taxonomyService.listJobs({ limit: 20 });
      setJobs(res.data);
      setListError(null);
    } catch (err) {
      setListError(taxonomyError(err));
    }
  }, []);

  const showJob = useCallback((next) => {
    jobRef.current = next;
    setJob(next);
  }, []);

  const loadJob = useCallback(async () => {
    if (!selectedJobId) return;
    try {
      const res = await taxonomyService.getJob(selectedJobId);
      const previous = jobRef.current;
      showJob(res.data);
      if (previous && isRunning(previous) && !isRunning(res.data)) {
        loadJobs();
        refreshLock?.();
      }
    } catch (err) {
      setError(taxonomyError(err));
    }
  }, [selectedJobId, loadJobs, refreshLock, showJob]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    showJob(null);
    setError(null);
    setAcknowledged(false);
    loadJob();
  }, [selectedJobId]); // eslint-disable-line react-hooks/exhaustive-deps

  usePolling(loadJob, isRunning(job));

  const act = async (fn, success) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      showJob(res.data);
      if (success) toast.success(success);
      loadJobs();
    } catch (err) {
      if (err?.response?.data?.lock) setLock?.(err.response.data.lock);
      setError(taxonomyError(err));
    } finally {
      setBusy(false);
      refreshLock?.();
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <div className={`${card} overflow-hidden lg:col-span-1 self-start`}>
        <p className="px-4 py-3 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">Import jobs</p>
        {listError ? (
          <div className="p-3">
            <ErrorBox error={listError} />
          </div>
        ) : jobs === null ? (
          <Loading />
        ) : jobs.length === 0 ? (
          <p className="text-center py-10 text-slate-400 text-sm">No import jobs yet. Upload a release under Data sources.</p>
        ) : (
          <ul>
            {jobs.map((j) => (
              <li key={j.job_id}>
                <button
                  type="button"
                  data-testid="job-row"
                  onClick={() => onSelectJob(j.job_id)}
                  className={`w-full text-left px-4 py-2.5 border-b border-slate-100 text-sm hover:bg-slate-50 ${j.job_id === selectedJobId ? 'bg-indigo-50' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-700">
                      {SOURCE_LABELS[j.source]} · {j.dataset_version}
                    </span>
                    <StatusBadge status={j.status} />
                  </div>
                  <p className="text-xs text-slate-400">{formatTime(j.created_at)}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="lg:col-span-2 space-y-3">
        <ErrorBox error={error} onDismiss={() => setError(null)} />
        {!selectedJobId ? (
          <p className="text-sm text-slate-500">Select an import job to see its validation, preview and checks.</p>
        ) : !job ? (
          error ? null : <Loading />
        ) : (
          <JobDetail
            job={job}
            lock={lock}
            busy={busy}
            acknowledged={acknowledged}
            setAcknowledged={setAcknowledged}
            onPreview={() => act(() => taxonomyService.preview(job.job_id), 'Preview started')}
            onCancel={() => act(() => taxonomyService.cancel(job.job_id), 'Job cancelled')}
            onPublish={() => act(() => taxonomyService.publish(job.job_id, acknowledged), 'Publishing started')}
          />
        )}
        {job && FINAL_STATUSES.includes(job.status) && (
          <p className="text-xs text-slate-400">This job is finished; upload a new release to start again.</p>
        )}
      </div>
    </div>
  );
}
