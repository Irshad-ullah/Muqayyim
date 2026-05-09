import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services/authService.js';
import toast from 'react-hot-toast';
import { Mail, BrainCircuit, ArrowLeft, CheckCircle2, SendHorizonal } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) { setError('Email is required'); return; }
    if (!/\S+@\S+\.\S+/.test(email)) { setError('Enter a valid email address'); return; }

    setLoading(true);
    try {
      await authService.forgotPassword(email);
      setSent(true);
      toast.success('Reset link sent if the email exists');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md animate-slide-up">
        {/* Logo */}
        <Link to="/login" className="flex items-center gap-2.5 mb-8 w-fit">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <BrainCircuit className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold text-slate-900">
            MU<span className="text-indigo-600">QAYYIM</span>
          </span>
        </Link>

        <div className="card p-8">
          {!sent ? (
            <>
              <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mb-5">
                <Mail className="w-6 h-6 text-indigo-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-1">Forgot password?</h2>
              <p className="text-slate-500 text-sm mb-7">
                Enter the email linked to your account and we'll send you a reset link.
              </p>

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <div>
                  <label className="label">Email address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(''); }}
                      placeholder="you@example.com"
                      className={`input-field pl-10 ${error ? 'error' : ''}`}
                      autoComplete="email"
                    />
                  </div>
                  {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
                </div>

                <button type="submit" disabled={loading} className="btn-primary">
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <SendHorizonal className="w-4 h-4" />
                      Send reset link
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
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Check your inbox</h2>
              <p className="text-slate-500 text-sm leading-relaxed mb-2">
                If <span className="font-medium text-slate-700">{email}</span> matches an account,
                you'll receive a password reset link shortly.
              </p>
              <p className="text-xs text-slate-400 mb-7">
                Didn't receive it? Check your spam folder or{' '}
                <button
                  onClick={() => setSent(false)}
                  className="text-indigo-600 hover:underline font-medium"
                >
                  try again
                </button>
                .
              </p>
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
