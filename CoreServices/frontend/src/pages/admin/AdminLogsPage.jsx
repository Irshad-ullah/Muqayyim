import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { adminService } from '../../services/adminService.js';

// Admin → Error Logs: errors from all services (Core, AI, Gateway) and
// security events. Stacks are only loaded in the detail drawer.

const PAGE_SIZE = 20;
const SERVICES = ['core', 'ai', 'gateway'];
const LEVELS = ['critical', 'error', 'warning'];

const LEVEL_STYLES = {
  critical: 'bg-red-600 text-white',
  error: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-800',
};
const SERVICE_LABELS = { core: 'Core', ai: 'AI', gateway: 'Gateway' };

const formatTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

const toIso = (local) => (local ? new Date(local).toISOString() : undefined);

export function LevelBadge({ level }) {
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${LEVEL_STYLES[level] || 'bg-slate-100 text-slate-600'}`}>
      {level}
    </span>
  );
}

function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-500">
      <span>
        Page {pagination.page} of {pagination.pages} · {pagination.total} entries
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          aria-label="Previous page"
          onClick={() => onPage(pagination.page - 1)}
          disabled={pagination.page <= 1}
          className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          aria-label="Next page"
          onClick={() => onPage(pagination.page + 1)}
          disabled={pagination.page >= pagination.pages}
          className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Drawer({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full bg-white shadow-xl overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</p>
      <div className="text-sm text-slate-800 mt-0.5 break-words">{children ?? '—'}</div>
    </div>
  );
}

function CopyButton({ value, label }) {
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        toast.success('Request ID copied');
      }}
      aria-label={label}
      className="inline-flex items-center gap-1 ml-2 text-xs text-indigo-600 hover:text-indigo-700"
    >
      <Copy className="w-3.5 h-3.5" /> Copy
    </button>
  );
}

// ── Error logs tab ───────────────────────────────────────────────────────────
const EMPTY_FILTERS = { service: '', level: '', module: '', from: '', to: '', search: '', unacknowledged: false };

export function buildErrorLogParams(filters, page) {
  const params = { page, limit: PAGE_SIZE };
  if (filters.service) params.service = filters.service;
  if (filters.level) params.level = filters.level;
  if (filters.module.trim()) params.module = filters.module.trim();
  if (filters.search.trim()) params.search = filters.search.trim();
  if (filters.from) params.from = toIso(filters.from);
  if (filters.to) params.to = toIso(filters.to);
  if (filters.unacknowledged) params.acknowledged = 'false';
  return params;
}

function ErrorLogsTab() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [draft, setDraft] = useState(EMPTY_FILTERS); // text inputs, applied on submit
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], pagination: null, partial: false, notice: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [acking, setAcking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminService.getErrorLogs(buildErrorLogParams(filters, page));
      setResult({ data: res.data || [], pagination: res.pagination, partial: !!res.partial, notice: res.notice });
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load error logs');
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  const apply = (patch) => {
    setPage(1);
    setFilters((f) => ({ ...f, ...patch }));
    setDraft((d) => ({ ...d, ...patch }));
  };

  const open = async (row) => {
    setSelected(row);
    setDetail(null);
    try {
      const res = await adminService.getErrorLog(row.service, row.id);
      setDetail(res.data);
    } catch (err) {
      setDetail({ ...row, stack: null, loadError: err?.response?.data?.message || 'Could not load details' });
    }
  };

  const acknowledge = async () => {
    if (!selected) return;
    setAcking(true);
    try {
      const res = await adminService.acknowledgeErrorLog(selected.service, selected.id);
      const updated = res.data || { acknowledged: true };
      setResult((r) => ({
        ...r,
        data: r.data.map((row) => (row.id === selected.id && row.service === selected.service ? { ...row, ...updated } : row)),
      }));
      setDetail((d) => (d ? { ...d, ...updated } : d));
      setSelected((s) => ({ ...s, ...updated }));
      toast.success('Marked as acknowledged');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to acknowledge');
    } finally {
      setAcking(false);
    }
  };

  const shown = detail || selected;

  return (
    <>
      {/* Filters */}
      <form
        className="bg-white rounded-xl border border-slate-200 p-4 mb-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ module: draft.module, search: draft.search, from: draft.from, to: draft.to });
        }}
      >
        <label className="text-xs text-slate-500">
          Service
          <select aria-label="Service" className="input-field mt-1" value={filters.service} onChange={(e) => apply({ service: e.target.value })}>
            <option value="">All</option>
            {SERVICES.map((s) => (
              <option key={s} value={s}>{SERVICE_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Level
          <select aria-label="Level" className="input-field mt-1" value={filters.level} onChange={(e) => apply({ level: e.target.value })}>
            <option value="">All</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Module
          <input aria-label="Module" className="input-field mt-1" value={draft.module} placeholder="e.g. auth" onChange={(e) => setDraft({ ...draft, module: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">
          From
          <input aria-label="From" type="datetime-local" className="input-field mt-1" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">
          To
          <input aria-label="To" type="datetime-local" className="input-field mt-1" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500 md:col-span-2">
          Search
          <div className="relative mt-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              aria-label="Search"
              className="input-field pl-9"
              value={draft.search}
              placeholder="Message, type or request ID"
              onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            />
          </div>
        </label>
        <div className="flex flex-col gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={filters.unacknowledged} onChange={(e) => apply({ unacknowledged: e.target.checked })} />
            Unacknowledged only
          </label>
          <button type="submit" className="btn-primary py-2">
            <Filter className="w-4 h-4" /> Apply
          </button>
        </div>
      </form>

      {result.partial && (
        <div role="status" className="mb-4 flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-lg">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {result.notice || 'Some services could not be reached; results are partial.'}
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {['Time', 'Level', 'Service', 'Module', 'Type', 'Message', 'Request ID', 'Ack'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">Loading…</td></tr>
              ) : result.data.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">No error log entries match these filters.</td></tr>
              ) : (
                result.data.map((row) => (
                  <tr
                    key={`${row.service}:${row.id}`}
                    data-testid="error-row"
                    onClick={() => open(row)}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{formatTime(row.timestamp)}</td>
                    <td className="px-4 py-2.5"><LevelBadge level={row.level} /></td>
                    <td className="px-4 py-2.5">{SERVICE_LABELS[row.service] || row.service}</td>
                    <td className="px-4 py-2.5 text-slate-600">{row.module}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{row.errorType}</td>
                    <td className="px-4 py-2.5 max-w-xs truncate" title={row.message}>{row.message}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{row.requestId ? `${row.requestId.slice(0, 13)}…` : '—'}</td>
                    <td className="px-4 py-2.5">
                      {row.acknowledged ? (
                        <CheckCircle2 aria-label="Acknowledged" className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination pagination={result.pagination} onPage={setPage} />
      </div>

      {shown && (
        <Drawer title="Error details" onClose={() => { setSelected(null); setDetail(null); }}>
          <div className="flex items-center gap-2">
            <LevelBadge level={shown.level} />
            <span className="text-sm text-slate-500">{SERVICE_LABELS[shown.service]} · {shown.module}</span>
          </div>
          <Field label="Type"><span className="font-mono">{shown.errorType}</span></Field>
          <Field label="Message"><span className="whitespace-pre-wrap">{shown.message}</span></Field>
          <Field label="Time">{formatTime(shown.timestamp)}</Field>
          <Field label="Request ID">
            <span className="font-mono">{shown.requestId || '—'}</span>
            <CopyButton value={shown.requestId} label="Copy request ID" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Method">{shown.method}</Field>
            <Field label="Path"><span className="font-mono text-xs">{shown.path}</span></Field>
            <Field label="Status">{shown.statusCode}</Field>
          </div>
          <Field label="User ID"><span className="font-mono text-xs">{shown.userId}</span></Field>
          <Field label="Stack trace">
            {detail === null ? (
              <span className="text-slate-400">Loading…</span>
            ) : detail.loadError ? (
              <span className="text-red-600">{detail.loadError}</span>
            ) : detail.stack ? (
              <pre className="mt-1 text-xs bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto whitespace-pre">{detail.stack}</pre>
            ) : (
              <span className="text-slate-400">No stack recorded</span>
            )}
          </Field>
          <div className="pt-2 border-t border-slate-100">
            {shown.acknowledged ? (
              <p className="text-sm text-emerald-700 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Acknowledged{shown.acknowledgedAt ? ` · ${formatTime(shown.acknowledgedAt)}` : ''}
              </p>
            ) : (
              <button type="button" onClick={acknowledge} disabled={acking} className="btn-primary w-auto px-5">
                <CheckCircle2 className="w-4 h-4" /> {acking ? 'Acknowledging…' : 'Acknowledge'}
              </button>
            )}
          </div>
        </Drawer>
      )}
    </>
  );
}

// ── Security events tab ─────────────────────────────────────────────────────
function SecurityEventsTab() {
  const [filters, setFilters] = useState({ event: '', userId: '', from: '', to: '' });
  const [draft, setDraft] = useState({ userId: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], pagination: null, events: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit: PAGE_SIZE };
      if (filters.event) params.event = filters.event;
      if (filters.userId.trim()) params.userId = filters.userId.trim();
      if (filters.from) params.from = toIso(filters.from);
      if (filters.to) params.to = toIso(filters.to);
      const res = await adminService.getSecurityEvents(params);
      setResult({ data: res.data || [], pagination: res.pagination, events: res.events || [] });
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load security events');
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <form
        className="bg-white rounded-xl border border-slate-200 p-4 mb-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilters((f) => ({ ...f, ...draft }));
        }}
      >
        <label className="text-xs text-slate-500">
          Event
          <select aria-label="Event" className="input-field mt-1" value={filters.event} onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, event: e.target.value })); }}>
            <option value="">All</option>
            {result.events.map((ev) => (
              <option key={ev} value={ev}>{ev}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          User ID
          <input aria-label="User ID" className="input-field mt-1" value={draft.userId} onChange={(e) => setDraft({ ...draft, userId: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">
          From
          <input aria-label="Security from" type="datetime-local" className="input-field mt-1" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">
          To
          <input aria-label="Security to" type="datetime-local" className="input-field mt-1" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <button type="submit" className="btn-primary py-2">
          <Filter className="w-4 h-4" /> Apply
        </button>
      </form>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {['Time', 'Event', 'User ID', 'IP', 'Request ID'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-10 text-slate-400">Loading…</td></tr>
              ) : result.data.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-10 text-slate-400">No security events match these filters.</td></tr>
              ) : (
                result.data.map((row) => (
                  <tr key={row.id} data-testid="security-row" onClick={() => setSelected(row)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{formatTime(row.timestamp)}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{row.event}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{row.userId || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{row.ip || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{row.requestId ? `${row.requestId.slice(0, 13)}…` : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination pagination={result.pagination} onPage={setPage} />
      </div>

      {selected && (
        <Drawer title="Security event" onClose={() => setSelected(null)}>
          <Field label="Event">{selected.event}</Field>
          <Field label="Time">{formatTime(selected.timestamp)}</Field>
          <Field label="User ID"><span className="font-mono text-xs">{selected.userId}</span></Field>
          <Field label="IP"><span className="font-mono text-xs">{selected.ip}</span></Field>
          <Field label="Request ID">
            <span className="font-mono">{selected.requestId || '—'}</span>
            <CopyButton value={selected.requestId} label="Copy request ID" />
          </Field>
          <Field label="Details">
            <pre className="mt-1 text-xs bg-slate-50 rounded-lg p-3 overflow-x-auto">{JSON.stringify(selected.details || {}, null, 2)}</pre>
          </Field>
        </Drawer>
      )}
    </>
  );
}

export default function AdminLogsPage() {
  const [tab, setTab] = useState('errors');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <AdminLayout title="Error Logs">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="inline-flex bg-white border border-slate-200 rounded-xl p-1" role="tablist">
          {[
            { key: 'errors', label: 'Error Logs', icon: AlertTriangle },
            { key: 'security', label: 'Security Events', icon: ShieldAlert },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
                tab === key ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 bg-white px-3 py-2 rounded-lg"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>
      {tab === 'errors' ? <ErrorLogsTab key={`e${refreshKey}`} /> : <SecurityEventsTab key={`s${refreshKey}`} />}
    </AdminLayout>
  );
}
