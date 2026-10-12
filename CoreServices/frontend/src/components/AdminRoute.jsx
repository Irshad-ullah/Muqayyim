import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Waits until the stored session has been re-checked with the server, then
// gates on the role from that fresh profile (the database role). The backend
// enforces the same rule on every admin request.
export default function AdminRoute({ children }) {
  const { isAuthenticated, user, sessionVerified } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!sessionVerified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (user?.role !== 'Admin') return <Navigate to="/dashboard" replace />;

  return children;
}
