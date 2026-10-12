import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { authService } from '../services/authService.js';
import { authEvents, SESSION_ENDED, SERVICE_UNAVAILABLE, NOTICE } from '../services/apiErrors.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // True once the stored session has been re-checked with the server, so
  // role-gated UI (AdminRoute) uses the database role, not the cached one.
  const [sessionVerified, setSessionVerified] = useState(false);

  useEffect(() => {
    const stored = authService.getStoredUser();
    const tok    = authService.getToken();
    if (stored && tok) {
      setUser(stored);
      authService.getProfile()
        .then(({ user: fresh }) => {
          setUser(fresh);
          localStorage.setItem('user', JSON.stringify(fresh));
        })
        // Revoked/suspended sessions are handled by the session-ended listener;
        // on network errors keep the cached user (the server still enforces roles).
        .catch(() => {})
        .finally(() => setSessionVerified(true));
    } else {
      setSessionVerified(true);
    }
    setLoading(false);
  }, []);

  // Central auth-error events (see services/apiErrors.js).
  useEffect(() => {
    const onSessionEnded = (e) => {
      authService.logout();
      setUser(null); // route guards redirect to /login
      toast.error(e.detail?.message || 'Your session has ended. Please log in again.', {
        id: 'session-ended',
        duration: 6000,
      });
    };
    const onUnavailable = (e) => {
      toast.error(e.detail?.message || 'Service temporarily unavailable, try again', { id: 'auth-unavailable' });
    };
    // Rate limits (429) and oversized requests (413): show, never log out.
    const onNotice = (e) => {
      toast.error(e.detail?.message, { id: e.detail?.code, duration: 6000 });
    };
    authEvents.addEventListener(SESSION_ENDED, onSessionEnded);
    authEvents.addEventListener(SERVICE_UNAVAILABLE, onUnavailable);
    authEvents.addEventListener(NOTICE, onNotice);
    return () => {
      authEvents.removeEventListener(SESSION_ENDED, onSessionEnded);
      authEvents.removeEventListener(SERVICE_UNAVAILABLE, onUnavailable);
      authEvents.removeEventListener(NOTICE, onNotice);
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await authService.login(email, password);
    setUser(data.user);
    setSessionVerified(true);
    return data;
  }, []);

  const register = useCallback(async (name, email, password, passwordConfirm) => {
    const data = await authService.register(name, email, password, passwordConfirm);
    setUser(data.user);
    setSessionVerified(true);
    return data;
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const data = await authService.getProfile();
      const updated = data.user;
      setUser(updated);
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    } catch {
      // Session-ending errors are handled centrally; others keep the session.
      return undefined;
    }
  }, []);

  const updateUser = useCallback((updated) => {
    setUser(updated);
    localStorage.setItem('user', JSON.stringify(updated));
  }, []);

  const value = {
    user,
    loading,
    isAuthenticated: !!user && !!authService.getToken(),
    sessionVerified,
    login,
    register,
    logout,
    refreshProfile,
    updateUser,
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500 font-medium">Loading…</p>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
