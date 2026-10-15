import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { RotateCcw } from 'lucide-react';
import { taxonomyService } from '../../../services/taxonomyService.js';
import RestoreDialog from './RestoreDialog.jsx';
import { ErrorBox, Loading, StatusBadge, btn, card } from './components.jsx';
import usePolling from './usePolling.js';
import { SOURCE_LABELS, formatBytes, formatTime, isRestoring, taxonomyError } from './taxonomyRules.js';

// History: kept snapshots (restore any of them), restores, and every import job.

const POOL_LABELS = { publish: 'Before publish', edit: 'Before edit' };

export default function HistoryTab({ lock, refreshLock, setLock }) {
  const [snapshots, setSnapshots] = useState(null);
  const [restores, setRestores] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const [dialogFor, setDialogFor] = useState(null);

  const load = useCallback(async () => {
    try {
      const [snaps, rest, jobList] = await Promise.all([
        taxonomyService.listSnapshots(),
        taxonomyService.listRestores(),
        taxonomyService.listJobs({ limit: 50 }),
      ]);
      setSnapshots(snaps.data);
      setRestores(rest.data);
      setJobs(jobList.data);
      setError(null);
    } catch (err) {
      setError(taxonomyError(err));
      setSnapshots((s) => s || []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const running = restores.find(isRestoring);
  usePolling(async () => {
    const res = await taxonomyService.getRestore(running.restore_id).catch(() => null);
    if (res && isRestoring(res.data)) {
      setRestores((list) => list.map((r) => (r.restore_id === res.data.restore_id ? res.data : r))); // latest progress
    } else if (res) {
      if (res.data.status === 'restored') toast.success('Restore finished');
      load();
      refreshLock?.();
    }
  }, Boolean(running));

  const startRestore = async (snapshotId) => {
    try {
      await taxonomyService.restore(snapshotId);
    } catch (err) {
      if (err?.response?.data?.lock) setLock?.(err.response.data.lock);
      throw err;
    }
    toast.success('Restore started');
    setDialogFor(null);
    load();
    refreshLock?.();
  };

  return (
    <div className="space-y-5">
      <ErrorBox error={error} />
      {running && (
        <div role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" data-testid="restore-running">
          Restoring snapshot {running.snapshot_id}: {running.progress || 'working…'}
        </div>
      )}

      <section className={`${card} overflow-hidden`}>
        <h3 className="px-4 py-3 text-sm font-semibold text-slate-800 border-b border-slate-100">Snapshots</h3>
        {snapshots === null ? (
          <Loading />
        ) : snapshots.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-sm">No snapshots yet. One is taken before every publish and every edit.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {['Taken', 'Kind', 'By', 'Data', 'Size', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.snapshot_id} className="border-t border-slate-100" data-testid="snapshot-row">
                  <td className="px-4 py-2 whitespace-nowrap">{formatTime(s.created_at)}</td>
                  <td className="px-4 py-2">
                    {s.reason === 'pre-restore' ? 'Before restore' : POOL_LABELS[s.pool] || s.reason}
                    {s.note && <p className="text-xs text-slate-500">{s.note}</p>}
                  </td>
                  <td className="px-4 py-2">{s.created_by}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {s.counts?.active_professions ?? '—'} active professions
                    {s.source_versions && Object.keys(s.source_versions).length > 0 && (
                      <p>
                        {Object.entries(s.source_versions)
                          .filter(([, v]) => !Array.isArray(v) || v.length > 0)
                          .map(([src, v]) => `${SOURCE_LABELS[src] || src} ${Array.isArray(v) ? v.join(', ') : v}`)
                          .join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">{formatBytes(s.size_bytes)}</td>
                  <td className="px-4 py-2 text-right">
                    <button type="button" className={btn.secondary} disabled={Boolean(lock) || Boolean(running)} onClick={() => setDialogFor(s.snapshot_id)}>
                      <RotateCcw className="w-4 h-4" /> Restore…
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {restores.length > 0 && (
        <section className={`${card} overflow-hidden`}>
          <h3 className="px-4 py-3 text-sm font-semibold text-slate-800 border-b border-slate-100">Restores</h3>
          <ul>
            {restores.map((r) => (
              <li key={r.restore_id} className="px-4 py-2 border-t border-slate-100 text-sm flex items-center justify-between gap-3">
                <span>
                  {formatTime(r.created_at)} · snapshot {r.snapshot_id} · by {r.created_by}
                  {r.error && <span className="block text-xs text-red-700">{r.error}</span>}
                </span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={`${card} overflow-hidden`}>
        <h3 className="px-4 py-3 text-sm font-semibold text-slate-800 border-b border-slate-100">Import jobs</h3>
        {jobs.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-sm">No import jobs yet.</p>
        ) : (
          <ul>
            {jobs.map((j) => (
              <li key={j.job_id} className="px-4 py-2 border-t border-slate-100 text-sm flex items-center justify-between gap-3">
                <span>
                  {SOURCE_LABELS[j.source]} {j.dataset_version} · {formatTime(j.created_at)} · by {j.created_by}
                  {j.published_by && j.published_by !== j.created_by ? ` · published by ${j.published_by}` : ''}
                </span>
                <StatusBadge status={j.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialogFor && <RestoreDialog snapshotId={dialogFor} lock={lock} onClose={() => setDialogFor(null)} onConfirm={startRestore} />}
    </div>
  );
}
