import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { authService } from '../services/authService.js';
import Navbar from '../components/Navbar.jsx';
import CVStatusBadge from '../components/CVStatusBadge.jsx';
import toast from 'react-hot-toast';
import {
  User,
  Mail,
  Save,
  LogOut,
  KeyRound,
  Shield,
  CheckCircle2,
  Pencil,
  X,
} from 'lucide-react';

export default function ProfilePage() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: user?.name || '', email: user?.email || '' });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.email) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Enter a valid email';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const data = await authService.updateProfile(form.name.trim(), form.email);
      updateUser(data.user);
      toast.success('Profile updated successfully');
      setEditing(false);
    } catch (err) {
      const msg = err?.response?.data?.message || 'Failed to update profile';
      toast.error(msg);
      if (msg.toLowerCase().includes('email')) setErrors({ email: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm({ name: user?.name || '', email: user?.email || '' });
    setErrors({});
    setEditing(false);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: '' }));
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          {/* Page heading */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900">Your Profile</h1>
            <p className="text-slate-500 text-sm mt-1">
              Manage your personal information and account settings.
            </p>
          </div>

          <div className="space-y-6">
            {/* Avatar + summary card */}
            <div className="card p-6">
              <div className="flex items-center gap-5">
                <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg flex-shrink-0">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-slate-900 truncate">{user?.name}</h2>
                  <p className="text-sm text-slate-500 truncate">{user?.email}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700">
                      <Shield className="w-3 h-3" />
                      {user?.role}
                    </span>
                    <CVStatusBadge status={user?.cvStatus || 'Not Uploaded'} />
                  </div>
                </div>
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="btn-secondary px-4 py-2 text-sm flex-shrink-0"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                )}
              </div>
            </div>

            {/* Edit / View form */}
            <div className="card p-6">
              <h3 className="text-base font-semibold text-slate-900 mb-5">
                Personal Information
              </h3>

              {editing ? (
                <form onSubmit={handleSave} noValidate className="space-y-4">
                  <div>
                    <label className="label">Full name</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        value={form.name}
                        onChange={set('name')}
                        className={`input-field pl-10 ${errors.name ? 'error' : ''}`}
                        autoComplete="name"
                      />
                    </div>
                    {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
                  </div>

                  <div>
                    <label className="label">Email address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <input
                        type="email"
                        value={form.email}
                        onChange={set('email')}
                        className={`input-field pl-10 ${errors.email ? 'error' : ''}`}
                        autoComplete="email"
                      />
                    </div>
                    {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <button type="submit" disabled={saving} className="btn-primary w-auto px-6">
                      {saving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Saving…
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Save changes
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="btn-secondary px-6"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <InfoRow
                    icon={User}
                    label="Full name"
                    value={user?.name}
                  />
                  <InfoRow
                    icon={Mail}
                    label="Email address"
                    value={user?.email}
                  />
                  <InfoRow
                    icon={Shield}
                    label="Role"
                    value={user?.role}
                  />
                  <InfoRow
                    icon={CheckCircle2}
                    label="CV Status"
                    value={user?.cvStatus || 'Not Uploaded'}
                  />
                </div>
              )}
            </div>

            {/* Security */}
            <div className="card p-6">
              <h3 className="text-base font-semibold text-slate-900 mb-5">Security</h3>
              <div className="flex items-center justify-between py-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center">
                    <KeyRound className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">Password</p>
                    <p className="text-xs text-slate-400">Last changed: unknown</p>
                  </div>
                </div>
                <a
                  href="/forgot-password"
                  onClick={(e) => { e.preventDefault(); navigate('/forgot-password'); }}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
                >
                  Change
                </a>
              </div>
            </div>

            {/* Danger zone */}
            <div className="card p-6 border-red-100">
              <h3 className="text-base font-semibold text-slate-900 mb-4">Account Actions</h3>
              <button onClick={handleLogout} className="btn-danger w-full sm:w-auto px-6">
                <LogOut className="w-4 h-4" />
                Sign out of MUQAYYIM
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-slate-100 last:border-0">
      <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-slate-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">{label}</p>
        <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">{value || '—'}</p>
      </div>
    </div>
  );
}
