import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminRoute from './components/AdminRoute.jsx';

// JobSeeker pages (existing — unchanged)
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import CVParsingPage from './pages/CVParsingPage.jsx';
import ProfileBuilderPage from './pages/ProfileBuilderPage.jsx';
import ViewProfilePage from './pages/ViewProfilePage.jsx';

// Admin pages
import AdminDashboardPage from './pages/admin/AdminDashboardPage.jsx';
import AdminUsersPage from './pages/admin/AdminUsersPage.jsx';
import AdminSystemPage from './pages/admin/AdminSystemPage.jsx';

export default function App() {
  const { isAuthenticated, user } = useAuth();

  // After login, admins go to /admin/dashboard; job seekers go to /dashboard
  const homeRoute = user?.role === 'Admin' ? '/admin/dashboard' : '/dashboard';

  return (
    <Routes>
      {/* ── Public routes ──────────────────────────────────────────────── */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to={homeRoute} replace /> : <LoginPage />}
      />
      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to={homeRoute} replace /> : <RegisterPage />}
      />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

      {/* ── JobSeeker protected routes ─────────────────────────────────── */}
      {/* If an admin somehow lands here, bounce them to admin dashboard   */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            {user?.role === 'Admin'
              ? <Navigate to="/admin/dashboard" replace />
              : <DashboardPage />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            {user?.role === 'Admin'
              ? <Navigate to="/admin/dashboard" replace />
              : <ProfilePage />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/cv-parsing"
        element={
          <ProtectedRoute>
            {user?.role === 'Admin'
              ? <Navigate to="/admin/dashboard" replace />
              : <CVParsingPage />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile-builder"
        element={
          <ProtectedRoute>
            {user?.role === 'Admin'
              ? <Navigate to="/admin/dashboard" replace />
              : <ProfileBuilderPage />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/view-profile"
        element={
          <ProtectedRoute>
            {user?.role === 'Admin'
              ? <Navigate to="/admin/dashboard" replace />
              : <ViewProfilePage />}
          </ProtectedRoute>
        }
      />

      {/* ── Admin protected routes ─────────────────────────────────────── */}
      <Route
        path="/admin/dashboard"
        element={
          <AdminRoute>
            <AdminDashboardPage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <AdminRoute>
            <AdminUsersPage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/system"
        element={
          <AdminRoute>
            <AdminSystemPage />
          </AdminRoute>
        }
      />

      {/* ── Default & catch-all ────────────────────────────────────────── */}
      <Route
        path="/"
        element={<Navigate to={isAuthenticated ? homeRoute : '/login'} replace />}
      />
      <Route
        path="*"
        element={<Navigate to={isAuthenticated ? homeRoute : '/login'} replace />}
      />
    </Routes>
  );
}
