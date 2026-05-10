import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Navbar from '../components/Navbar.jsx';
import CVStatusBadge, { CVStatusStepper } from '../components/CVStatusBadge.jsx';
import toast from 'react-hot-toast';
import {
  FileUp,
  User,
  RefreshCw,
  Clock,
  BrainCircuit,
  ArrowRight,
  Zap,
  ShieldCheck,
  BarChart3,
  BookOpen,
  PenSquare,
  Eye,
} from 'lucide-react';

const quickActions = [
  {
    icon: FileUp,
    label: 'Upload CV',
    description: 'Upload and parse your CV with AI',
    to: '/cv-parsing',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
  },
  {
    icon: PenSquare,
    label: 'Profile Builder',
    description: 'Build your full professional profile',
    to: '/profile-builder',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
  },
  {
    icon: Eye,
    label: 'View Profile',
    description: 'Preview your built professional profile',
    to: '/view-profile',
    color: 'text-rose-600',
    bg: 'bg-rose-50',
  },
  {
    icon: User,
    label: 'Account Settings',
    description: 'Update your name and email',
    to: '/profile',
    color: 'text-violet-600',
    bg: 'bg-violet-50',
  },
];

const infoCards = [
  {
    icon: Zap,
    title: 'AI Extraction',
    body: 'Skills, education and experience extracted automatically using spaCy NLP.',
    color: 'text-amber-500',
    bg: 'bg-amber-50',
  },
  {
    icon: ShieldCheck,
    title: 'Verified Data',
    body: 'You review and confirm every detail before it becomes your verified profile.',
    color: 'text-emerald-500',
    bg: 'bg-emerald-50',
  },
  {
    icon: BarChart3,
    title: 'Confidence Scores',
    body: 'Every extracted item carries a confidence score so you know what to check.',
    color: 'text-blue-500',
    bg: 'bg-blue-50',
  },
];

export default function DashboardPage() {
  const { user, refreshProfile } = useAuth();
  const [cvStatus, setCvStatus] = useState(user?.cvStatus || 'Not Uploaded');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user?.cvStatus) setCvStatus(user.cvStatus);
  }, [user]);

  // Auto-refresh CV status when the user tabs back to this page from Module 2.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) {
        refreshProfile()
          .then((updated) => { if (updated?.cvStatus) setCvStatus(updated.cvStatus); })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [refreshProfile]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const updated = await refreshProfile();
      if (updated?.cvStatus) setCvStatus(updated.cvStatus);
      toast.success('Status refreshed');
    } catch {
      toast.error('Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = user?.name?.split(' ')[0] || 'User';

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="pt-16">
        {/* Hero / Welcome Banner */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-700 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="text-indigo-200 text-sm font-medium mb-1">{greeting()},</p>
                <h1 className="text-3xl font-bold">{firstName} 👋</h1>
                <p className="text-indigo-200 text-sm mt-2">
                  Here's an overview of your MUQAYYIM account.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center gap-3">
                  <BrainCircuit className="w-5 h-5 text-indigo-200" />
                  <div>
                    <p className="text-xs text-indigo-200">Role</p>
                    <p className="text-sm font-semibold">{user?.role}</p>
                  </div>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center gap-3">
                  <Clock className="w-5 h-5 text-indigo-200" />
                  <div>
                    <p className="text-xs text-indigo-200">Member since</p>
                    <p className="text-sm font-semibold">
                      {user?.createdAt
                        ? new Date(user.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            year: 'numeric',
                          })
                        : 'Today'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* CV Status Card — spans 2 cols */}
            <div className="lg:col-span-2 card p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">CV Status</h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Track your CV through the parsing pipeline
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <CVStatusBadge status={cvStatus} size="lg" />
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600 focus:outline-none"
                    title="Refresh status"
                  >
                    <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <CVStatusStepper status={cvStatus} />

              <div className="mt-6 pt-5 border-t border-slate-100">
                {cvStatus === 'Not Uploaded' && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-500">
                      Upload your CV to start AI-powered analysis.
                    </p>
                    <Link
                      to="/cv-parsing"
                      className="flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                    >
                      Upload now <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                )}
                {cvStatus === 'Uploaded' && (
                  <p className="text-sm text-slate-500">
                    Your CV is uploaded. Head to the CV Parsing module to run NLP analysis.
                  </p>
                )}
                {cvStatus === 'Processing' && (
                  <p className="text-sm text-amber-600 font-medium">
                    AI is analysing your CV… this usually takes a few seconds.
                  </p>
                )}
                {cvStatus === 'Verified' && (
                  <p className="text-sm text-emerald-600 font-medium">
                    Your CV data is verified and saved to your profile.
                  </p>
                )}
              </div>
            </div>

            {/* Account Summary */}
            <div className="card p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-5">Account</h2>
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center text-white text-lg font-bold shadow-md flex-shrink-0">
                  {user?.name
                    ?.split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate">{user?.name}</p>
                  <p className="text-sm text-slate-500 truncate">{user?.email}</p>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-500">Role</span>
                  <span className="text-sm font-medium text-slate-800">{user?.role}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-500">CV Status</span>
                  <CVStatusBadge status={cvStatus} />
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-slate-500">User ID</span>
                  <span className="text-xs font-mono text-slate-400 truncate max-w-[100px]">
                    {user?.id?.slice(-8) || '—'}
                  </span>
                </div>
              </div>

              <Link to="/profile" className="btn-secondary w-full mt-5 text-sm">
                <User className="w-4 h-4" />
                Edit Profile
              </Link>
            </div>

            {/* Quick Actions */}
            <div className="card p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Quick Actions</h2>
              <div className="space-y-3">
                {quickActions.map(({ icon: Icon, label, description, to, color, bg }) => (
                  <Link key={label} to={to}>
                    <div className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 hover:border-indigo-100 hover:bg-indigo-50/30 transition-all duration-150 group cursor-pointer">
                      <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                        <Icon className={`w-5 h-5 ${color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* How it works */}
            <div className="lg:col-span-2 card p-6">
              <div className="flex items-center gap-2 mb-5">
                <BookOpen className="w-5 h-5 text-slate-400" />
                <h2 className="text-lg font-bold text-slate-900">How MUQAYYIM works</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {infoCards.map(({ icon: Icon, title, body, color, bg }) => (
                  <div key={title} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center mb-3`}>
                      <Icon className={`w-5 h-5 ${color}`} />
                    </div>
                    <h3 className="text-sm font-semibold text-slate-800 mb-1">{title}</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
