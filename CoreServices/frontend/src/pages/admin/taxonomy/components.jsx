import React from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, Lock } from 'lucide-react';
import { STATUS_LABELS, formatTime, lockLabel } from './taxonomyRules.js';

export const ATTRIBUTION = {
  onet:
    'O*NET 31.0 Database, U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), used under CC BY 4.0, modified',
  esco: 'ESCO v1.2.1 © European Union',
};

export const btn = {
  primary:
    'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed',
  secondary:
    'inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed',
  danger:
    'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed',
};
export const input =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50';
export const card = 'bg-white rounded-xl border border-slate-200';

export function ErrorBox({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{error.title}</p>
          <p>{error.message}</p>
          {error.details?.length > 0 && (
            <ul className="list-disc ml-5 mt-1 space-y-0.5">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="text-red-500 hover:text-red-700 text-xs">
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

export function LockBanner({ lock }) {
  const held = lockLabel(lock);
  if (!held) return null;
  return (
    <div role="status" data-testid="lock-banner" className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 flex items-center gap-2">
      <Lock className="w-4 h-4 flex-shrink-0" />
      <span>
        <strong>Taxonomy busy:</strong> {held.operation} — by {held.actor}
        {held.since ? `, since ${formatTime(held.since)}` : ''}. Changes are disabled until it finishes.
      </span>
    </div>
  );
}

const STATUS_STYLES = {
  validating: 'bg-sky-100 text-sky-800',
  previewing: 'bg-sky-100 text-sky-800',
  publishing: 'bg-sky-100 text-sky-800',
  restoring: 'bg-sky-100 text-sky-800',
  validated: 'bg-slate-100 text-slate-700',
  previewed: 'bg-indigo-100 text-indigo-800',
  published: 'bg-emerald-100 text-emerald-800',
  restored: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-700',
  rolled_back: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-slate-100 text-slate-500',
};

export function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[status] || 'bg-slate-100 text-slate-600'}`}>
      {['validating', 'previewing', 'publishing', 'restoring'].includes(status) && <Loader2 className="w-3 h-3 animate-spin" />}
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-500">
      <span>
        Page {pagination.page} of {pagination.pages} · {pagination.total} entries
      </span>
      <div className="flex gap-1">
        <button type="button" aria-label="Previous page" onClick={() => onPage(pagination.page - 1)} disabled={pagination.page <= 1} className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button type="button" aria-label="Next page" onClick={() => onPage(pagination.page + 1)} disabled={pagination.page >= pagination.pages} className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return <p className="text-center py-10 text-slate-400 text-sm">{label}</p>;
}
