import React, { useEffect, useState, useCallback } from 'react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { adminService } from '../../services/adminService.js';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Server,
  Database,
  Cpu,
  MemoryStick,
  Clock,
  Activity,
  Zap,
  Shield,
  FileText,
  Users,
  Tag,
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUptime(seconds) {
  if (seconds == null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const STATUS_CONFIG = {
  healthy: {
    icon: CheckCircle2,
    label: 'Healthy',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    border: 'border-emerald-200',
    headerBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
  },
  degraded: {
    icon: AlertTriangle,
    label: 'Degraded',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    border: 'border-amber-200',
    headerBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
  },
  unhealthy: {
    icon: XCircle,
    label: 'Unreachable',
    dot: 'bg-red-500',
    badge: 'bg-red-50 text-red-700 border-red-200',
    border: 'border-red-200',
    headerBg: 'bg-red-50',
    iconColor: 'text-red-600',
  },
  unknown: {
    icon: HelpCircle,
    label: 'Unknown',
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    border: 'border-slate-200',
    headerBg: 'bg-slate-50',
    iconColor: 'text-slate-500',
  },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.unknown;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.badge}`}>
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  );
}

function ProgressBar({ value, colorClass = 'bg-indigo-500', warnAt = 80, dangerAt = 95 }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const color = pct >= dangerAt ? 'bg-red-500' : pct >= warnAt ? 'bg-amber-500' : colorClass;
  return (
    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function MetricRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs font-medium text-slate-700">{value ?? '—'}</span>
    </div>
  );
}

function ServiceCard({ name, description, status, modules = [], metrics = {}, responseTimeMs, error, icon: Icon, children }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.unknown;
  const StatusIcon = cfg.icon;

  return (
    <div className={`bg-white rounded-xl border ${cfg.border} overflow-hidden`}>
      {/* Header */}
      <div className={`px-5 py-4 flex items-start justify-between ${cfg.headerBg} border-b ${cfg.border}`}>
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg bg-white border ${cfg.border} flex items-center justify-center flex-shrink-0 shadow-sm`}>
            <Icon className={`w-5 h-5 ${cfg.iconColor}`} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 text-sm">{name}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{description}</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-3">
        {/* Response time */}
        {responseTimeMs != null && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 flex items-center gap-1">
              <Zap className="w-3 h-3" /> Response time
            </span>
            <span className={`font-semibold ${responseTimeMs < 200 ? 'text-emerald-600' : responseTimeMs < 1000 ? 'text-amber-600' : 'text-red-600'}`}>
              {responseTimeMs} ms
            </span>
          </div>
        )}

        {/* Error message */}
        {error && status !== 'healthy' && (
          <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-100">
            {error}
          </p>
        )}

        {/* Hosted modules */}
        {modules.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {modules.map((m) => (
              <span key={m} className="text-[11px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium border border-indigo-100">
                {m}
              </span>
            ))}
          </div>
        )}

        {/* Extra metrics */}
        {children}
      </div>
    </div>
  );
}

const LOG_ACTION_COLORS = {
  UPDATE_USER: 'text-blue-600 bg-blue-50',
  DELETE_USER: 'text-red-600 bg-red-50',
  ACTIVATE_USER: 'text-emerald-600 bg-emerald-50',
  DEACTIVATE_USER: 'text-amber-600 bg-amber-50',
  CHANGE_USER_ROLE: 'text-violet-600 bg-violet-50',
  PROMOTE_TO_ADMIN: 'text-violet-600 bg-violet-50',
  CREATE_ADMIN: 'text-violet-600 bg-violet-50',
  CREATE_CONFIG: 'text-blue-600 bg-blue-50',
  UPDATE_CONFIG: 'text-blue-600 bg-blue-50',
  DELETE_CONFIG: 'text-red-600 bg-red-50',
};

function LogRow({ log }) {
  const colors = LOG_ACTION_COLORS[log.action] || 'text-slate-600 bg-slate-100';
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-2.5">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${colors}`}>
          {log.action}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs text-slate-600">{log.resource}</td>
      <td className="px-3 py-2.5 text-xs text-slate-500">
        {log.adminId?.name || 'Unknown'}
      </td>
      <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">
        {new Date(log.createdAt).toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })}
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminSystemPage() {
  const [health, setHealth] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [healthData, logsData] = await Promise.all([
        adminService.getSystemHealth(),
        adminService.getLogs({ limit: 8 }),
      ]);
      setHealth(healthData);
      setLogs(logsData.data || []);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load system health');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => load(true), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const { services, systemResources } = health || {};
  const process_ = systemResources?.process;
  const host = systemResources?.host;

  const overallStatus = health?.status || 'unknown';
  const overallCfg = STATUS_CONFIG[overallStatus] || STATUS_CONFIG.unknown;

  return (
    <AdminLayout title="System Health">
      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full animate-pulse ${loading ? 'bg-slate-300' : overallCfg.dot}`} />
          <span className="text-sm font-medium text-slate-700">
            Overall:{' '}
            <span className={overallStatus === 'healthy' ? 'text-emerald-600' : overallStatus === 'degraded' ? 'text-amber-600' : 'text-red-600'}>
              {overallStatus.charAt(0).toUpperCase() + overallStatus.slice(1)}
            </span>
          </span>
          {lastRefreshed && (
            <span className="text-xs text-slate-400">
              · Last checked {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing || loading}
          className="flex items-center gap-2 text-sm border border-slate-200 bg-white px-3 py-2 rounded-lg text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* ── Service cards ──────────────────────────────────────────────── */}
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
        Services
      </h2>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-7">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 h-44 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-7">
          {/* Core Service */}
          <ServiceCard
            name="Core Service"
            description="User Management · Profile Builder · Admin Panel"
            status={services?.coreService?.status || 'unknown'}
            modules={services?.coreService?.modules || []}
            icon={Server}
          >
            <div className="mt-1">
              <MetricRow label="Uptime" value={formatUptime(services?.coreService?.metrics?.uptime)} />
              <MetricRow label="Node.js" value={services?.coreService?.metrics?.nodeVersion} />
              <MetricRow label="Users" value={services?.coreService?.metrics?.totalUsers ?? '—'} />
              <MetricRow label="Profiles" value={services?.coreService?.metrics?.totalProfiles ?? '—'} />
            </div>
          </ServiceCard>

          {/* AI Service */}
          <ServiceCard
            name="AI Service"
            description="CV Parsing · NLP Extraction"
            status={services?.aiService?.status || 'unknown'}
            modules={services?.aiService?.modules || []}
            responseTimeMs={services?.aiService?.responseTimeMs}
            error={services?.aiService?.error}
            icon={Activity}
          >
            {services?.aiService?.statusCode && (
              <MetricRow label="HTTP status" value={services.aiService.statusCode} />
            )}
            <MetricRow label="Endpoint" value={services?.aiService?.url || '—'} />
          </ServiceCard>

          {/* MongoDB */}
          <ServiceCard
            name="MongoDB"
            description="Primary database"
            status={services?.mongodb?.status || 'unknown'}
            modules={[]}
            icon={Database}
          >
            <MetricRow label="State" value={services?.mongodb?.stateLabel} />
            <MetricRow label="Users collection" value={services?.mongodb?.metrics?.totalUsers ?? '—'} />
            <MetricRow label="Profiles collection" value={services?.mongodb?.metrics?.totalProfiles ?? '—'} />
          </ServiceCard>
        </div>
      )}

      {/* ── System resources ───────────────────────────────────────────── */}
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
        System Resources
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-7">
        {/* Process memory */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <MemoryStick className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">Heap Memory</h3>
          </div>
          {loading ? (
            <div className="space-y-3">
              <div className="h-3 bg-slate-100 rounded animate-pulse w-3/4" />
              <div className="h-2 bg-slate-100 rounded animate-pulse" />
            </div>
          ) : (
            <>
              <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                <span>{formatBytes(process_?.memory?.heapUsed)} used</span>
                <span>{process_?.memory?.heapUsedPercent ?? 0}%</span>
              </div>
              <ProgressBar value={process_?.memory?.heapUsedPercent} />
              <div className="mt-3 grid grid-cols-2 gap-x-4 text-xs">
                <MetricRow label="Heap total" value={formatBytes(process_?.memory?.heapTotal)} />
                <MetricRow label="RSS" value={formatBytes(process_?.memory?.rss)} />
              </div>
            </>
          )}
        </div>

        {/* Host memory */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">Host Resources</h3>
          </div>
          {loading ? (
            <div className="space-y-3">
              <div className="h-3 bg-slate-100 rounded animate-pulse w-3/4" />
              <div className="h-2 bg-slate-100 rounded animate-pulse" />
            </div>
          ) : (
            <>
              <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                <span>Memory: {formatBytes(host?.totalMemory - host?.freeMemory)} / {formatBytes(host?.totalMemory)}</span>
                <span>{host?.memoryUsedPercent ?? 0}%</span>
              </div>
              <ProgressBar value={host?.memoryUsedPercent} colorClass="bg-violet-500" />
              <div className="mt-3 grid grid-cols-2 gap-x-4 text-xs">
                <MetricRow label="Platform" value={host?.platform} />
                <MetricRow label="Architecture" value={host?.arch} />
                <MetricRow label="CPUs" value={host?.cpus} />
                <MetricRow
                  label="Uptime"
                  value={formatUptime(process_?.uptime)}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Recent audit logs ──────────────────────────────────────────── */}
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
        Recent Admin Actions
      </h2>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-10">No admin actions recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Action</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Resource</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Admin</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => <LogRow key={log._id} log={log} />)}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}
