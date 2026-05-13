import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { adminService } from '../../services/adminService.js';
import {
  Users,
  FileText,
  CheckCircle,
  Github,
  RefreshCw,
  Activity,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';

const MODULE_LABELS = {
  userManagement: 'User Management',
  cvParsing: 'CV Parsing',
  profileBuilder: 'Profile Builder',
  adminPanel: 'Admin Panel',
  careerMatching: 'Career Matching',
  interviewPrep: 'Interview Prep',
  learningPath: 'Learning Path',
  cvGeneration: 'CV Generation',
  jobBoard: 'Job Board',
};

function StatCard({ icon: Icon, label, value, color, sub }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-start gap-4">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-800">
          {value === 'not_available' ? '—' : value ?? '—'}
        </p>
        <p className="text-sm text-slate-500 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function ModuleBadge({ name, status }) {
  const isActive = status === 'active';
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-700">{MODULE_LABELS[name] ?? name}</span>
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
          isActive
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-slate-100 text-slate-500'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
        {isActive ? 'Active' : 'Not available'}
      </span>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [summary, setSummary] = useState(null);
  const [modules, setModules] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const greet = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [summaryData, statusData] = await Promise.all([
        adminService.getSummary(),
        adminService.getSystemStatus(),
      ]);
      setSummary(summaryData.summary);
      setModules(statusData.modules);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <AdminLayout title="Dashboard">
      {/* Welcome */}
      <div className="flex items-center justify-between mb-7">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">
            {greet()}, {user?.name?.split(' ')[0]} 👋
          </h2>
          <p className="text-sm text-slate-500 mt-1">Here's what's happening in the system today.</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 bg-white px-3 py-2 rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* KPI cards */}
      {loading ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-7">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 h-24 animate-pulse">
              <div className="flex gap-4">
                <div className="w-11 h-11 bg-slate-200 rounded-lg" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-5 bg-slate-200 rounded w-12" />
                  <div className="h-3 bg-slate-100 rounded w-24" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-7">
          <StatCard
            icon={Users}
            label="Total Users"
            value={summary?.totalUsers}
            color="bg-indigo-600"
            sub={`${summary?.recentRegistrations ?? 0} new this month`}
          />
          <StatCard
            icon={FileText}
            label="CVs Uploaded"
            value={summary?.uploadedCVs}
            color="bg-violet-600"
          />
          <StatCard
            icon={CheckCircle}
            label="CVs Parsed"
            value={summary?.parsedCVs}
            color="bg-emerald-600"
          />
          <StatCard
            icon={Github}
            label="GitHub Connected"
            value={summary?.githubConnected}
            color="bg-slate-700"
          />
        </div>
      )}

      {/* Bottom section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Module status */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-slate-500" />
            <h3 className="font-semibold text-slate-800 text-sm">Module Status</h3>
          </div>
          {modules ? (
            Object.entries(modules).map(([key, status]) => (
              <ModuleBadge key={key} name={key} status={status} />
            ))
          ) : (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-7 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800 text-sm mb-4">Quick Actions</h3>
          <div className="space-y-3">
            <button
              onClick={() => navigate('/admin/users')}
              className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <Users className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-slate-700">Manage Users</p>
                  <p className="text-xs text-slate-500">View, edit and control user accounts</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
            </button>

            <button
              onClick={() => navigate('/admin/system')}
              className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <Activity className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-slate-700">System Health</p>
                  <p className="text-xs text-slate-500">Monitor service health and resources</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 transition-colors" />
            </button>

            <div className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-200 opacity-50 cursor-not-allowed">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Activity className="w-4 h-4 text-slate-500" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-slate-700">System Configuration</p>
                  <p className="text-xs text-slate-500">Tune system settings — coming soon</p>
                </div>
              </div>
              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-medium">Soon</span>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
