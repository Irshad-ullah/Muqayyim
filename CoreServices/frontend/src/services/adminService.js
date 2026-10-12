import axios from 'axios';
import { installAuthInterceptor } from './apiErrors.js';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const adminAPI = axios.create({
  baseURL: `${API_BASE_URL}/api/admin`,
});

adminAPI.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
installAuthInterceptor(adminAPI);

export const adminService = {
  // ── Dashboard ──────────────────────────────────────────────────────────────
  getSummary: () => adminAPI.get('/dashboard/summary').then((r) => r.data),
  getMetrics: () => adminAPI.get('/dashboard/metrics').then((r) => r.data),

  // ── System ─────────────────────────────────────────────────────────────────
  getSystemStatus: () => adminAPI.get('/system/status').then((r) => r.data),
  getSystemHealth: () => adminAPI.get('/system/health').then((r) => r.data),
  getLogs: (params) => adminAPI.get('/system/logs', { params }).then((r) => r.data),

  // ── Users ──────────────────────────────────────────────────────────────────
  getUsers: (params) => adminAPI.get('/users', { params }).then((r) => r.data),
  getUserById: (id) => adminAPI.get(`/users/${id}`).then((r) => r.data),
  updateUser: (id, data) => adminAPI.put(`/users/${id}`, data).then((r) => r.data),
  toggleUserStatus: (id, isActive) =>
    adminAPI.patch(`/users/${id}/status`, { isActive }).then((r) => r.data),
  updateUserRole: (id, role) =>
    adminAPI.patch(`/users/${id}/role`, { role }).then((r) => r.data),
  deleteUser: (id) => adminAPI.delete(`/users/${id}`).then((r) => r.data),
  unlockUser: (id) => adminAPI.post(`/users/${id}/unlock`).then((r) => r.data),

  // ── Admin accounts ─────────────────────────────────────────────────────────
  createAdmin: (data) => adminAPI.post('/auth/create-admin', data).then((r) => r.data),
};
