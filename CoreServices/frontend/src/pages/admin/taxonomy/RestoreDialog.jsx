import React, { useEffect, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { taxonomyService } from '../../../services/taxonomyService.js';
import { ErrorBox, Loading, btn, input } from './components.jsx';
import { SOURCE_LABELS, formatTime, taxonomyError } from './taxonomyRules.js';

export const CONFIRM_WORD = 'RESTORE';

const REASONS = { publish: 'before a publish', edit: 'before an edit', 'pre-restore': 'before a restore' };

// Confirmation for a whole-state restore: lists exactly what will be undone (from
// GET /snapshots/{id}) and needs the word RESTORE typed before the button is enabled.
export default function RestoreDialog({ snapshotId, lock, onClose, onConfirm }) {
  const [details, setDetails] = useState(null);
  const [error, setError] = useState(null);
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    taxonomyService
      .getSnapshot(snapshotId)
      .then((res) => !cancelled && setDetails(res.data))
      .catch((err) => !cancelled && setError(taxonomyError(err)));
    return () => {
      cancelled = true;
    };
  }, [snapshotId]);

  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(snapshotId);
    } catch (err) {
      setError(taxonomyError(err));
      setSubmitting(false);
    }
  };

  const snap = details?.snapshot;
  const imports = details?.imports_undone || [];
  const edits = details?.edits_undone || [];
  const restores = details?.restores_after || [];
  const nothing = details && !imports.length && !edits.length && !restores.length;
  const ready = typed.trim() === CONFIRM_WORD && details && !lock && !submitting;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="restore-title">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-auto p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h2 id="restore-title" className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-red-600" /> Restore snapshot
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <ErrorBox error={error} />
        {!details ? (
          error ? null : <Loading />
        ) : (
          <>
            <p className="text-sm text-slate-700">
              The professions, ESCO skills, skill descriptions, aliases, categories and the role-skill index go back to how they were on{' '}
              <strong>{formatTime(snap.created_at)}</strong> (taken {REASONS[snap.reason] || snap.reason} by {snap.created_by}). The current
              state is saved first, so this restore can itself be undone.
            </p>
            <div className="text-sm space-y-3" data-testid="undone-list">
              <p className="font-semibold text-slate-800">This undoes:</p>
              {nothing && <p className="text-slate-500">Nothing — no imports or edits were made after this snapshot.</p>}
              {imports.length > 0 && (
                <div>
                  <p className="text-slate-600">Imports ({imports.length})</p>
                  <ul className="list-disc ml-5 text-slate-700">
                    {imports.map((i) => (
                      <li key={i.job_id}>
                        {SOURCE_LABELS[i.source]} {i.dataset_version}, published by {i.published_by || i.created_by} on {formatTime(i.updated_at)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {edits.length > 0 && (
                <div>
                  <p className="text-slate-600">Edits ({edits.length})</p>
                  <ul className="list-disc ml-5 text-slate-700">
                    {edits.map((e) => (
                      <li key={e.snapshot_id}>
                        {e.note || 'Edit'} — by {e.created_by}, {formatTime(e.created_at)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {restores.length > 0 && (
                <div>
                  <p className="text-slate-600">Restores ({restores.length})</p>
                  <ul className="list-disc ml-5 text-slate-700">
                    {restores.map((r) => (
                      <li key={r.snapshot_id}>
                        Restore by {r.created_by}, {formatTime(r.created_at)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <label className="block text-sm text-slate-700">
              Type <strong>{CONFIRM_WORD}</strong> to confirm
              <input className={`${input} mt-1`} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Confirmation word" autoComplete="off" />
            </label>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btn.danger} disabled={!ready} onClick={confirm}>
            {submitting ? 'Starting…' : 'Restore'}
          </button>
        </div>
      </div>
    </div>
  );
}
