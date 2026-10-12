import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { authService } from '../services/authService.js';
import toast from 'react-hot-toast';
import {
  Lock,
  Eye,
  EyeOff,
  BrainCircuit,
  ArrowLeft,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import PasswordChecklist from '../components/PasswordChecklist.jsx';
import { isHandledGlobally } from '../services/apiErrors.js';
import { validatePassword } from '../constants/passwordPolicy.js';

export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState({ password: '', passwordConfirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState({});

  const fieldErrors = (f) => {
    const e = {};
    if (!f.password) e.password = 'Password is required';
    else {
      const check = validatePassword(f.password);
      if (!check.valid) e.password = check.errors[0];
    }
    if (!f.passwordConfirm) e.passwordConfirm = 'Please confirm your password';
    else if (f.password !== f.passwordConfirm) e.passwordConfirm = 'Passwords do not match';
    return e;
  };
  const formValid = Object.keys(fieldErrors(form)).length === 0;

  const validate = () => {
    const e = fieldErrors(form);
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      await authService.resetPassword(token, form.password, form.passwordConfirm);
      setDone(true);
      toast.success('Password reset successfully!');
    } catch (err) {
      const data = err?.response?.data || {};
      const msg = data.message || 'Reset link is invalid or expired';
      if (!isHandledGlobally(err)) toast.error(msg);
      setErrors({ [data.field || 'password']: msg });
    } finally {
      setLoading(false);
    }
  };

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: '' }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md animate-slide-up">
        <Link to="/login" className="flex items-center gap-2.5 mb-8 w-fit">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <BrainCircuit className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold text-slate-900">
            MU<span className="text-indigo-600">QAYYIM</span>
          </span>
        </Link>

        <div className="card p-8">
          {!done ? (
            <>
              <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mb-5">
                <ShieldCheck className="w-6 h-6 text-indigo-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-1">Set new password</h2>
              <p className="text-slate-500 text-sm mb-7">
                Choose a strong password for your account.
              </p>

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <div>
                  <label className="label">New password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={set('password')}
                      placeholder="••••••••"
                      className={`input-field pl-10 pr-10 ${errors.password ? 'error' : ''}`}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="mt-1 text-xs text-red-500">{errors.password}</p>
                  )}
                  <PasswordChecklist password={form.password} />
                </div>

                <div>
                  <label className="label">Confirm new password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={form.passwordConfirm}
                      onChange={set('passwordConfirm')}
                      placeholder="••••••••"
                      className={`input-field pl-10 pr-10 ${errors.passwordConfirm ? 'error' : ''}`}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.passwordConfirm && (
                    <p className="mt-1 text-xs text-red-500">{errors.passwordConfirm}</p>
                  )}
                </div>

                <button type="submit" disabled={loading || !formValid} className="btn-primary">
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Resetting…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      Reset password
                    </>
                  )}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center">
              <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Password updated!</h2>
              <p className="text-slate-500 text-sm mb-7">
                Your password has been reset. You can now sign in with your new password.
              </p>
              <button onClick={() => navigate('/login')} className="btn-primary">
                Go to sign in
              </button>
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-slate-100">
            <Link
              to="/login"
              className="flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-indigo-600 font-medium transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
