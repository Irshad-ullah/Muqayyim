import axios from 'axios';
import { installAuthInterceptor, resetAuthErrorState } from './apiErrors.js';
import { API_BASE_URL } from '../config/api.js';

export const authAPI = axios.create({
  baseURL: `${API_BASE_URL}/api/auth`,
});

export const cvAPI = axios.create({
  baseURL: `${API_BASE_URL}/api/cv`,
});

const attachToken = (api) => {
  api.interceptors.request.use(
    (config) => {
      const token = localStorage.getItem('token');
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    },
    (error) => Promise.reject(error)
  );
};

attachToken(authAPI);
attachToken(cvAPI);
// Session-ending auth errors (revoked/expired/suspended) are handled centrally.
installAuthInterceptor(authAPI);
installAuthInterceptor(cvAPI);

// The JWT used to be mirrored into a JS-readable `muqayyim_jwt` cookie for the
// removed standalone CV-parsing app. Expire any copy left in existing browsers.
if (typeof document !== 'undefined') {
  document.cookie = 'muqayyim_jwt=; path=/; SameSite=Lax; max-age=0';
}

export const authService = {
  register: async (name, email, password, passwordConfirm) => {
    const { data } = await authAPI.post('/register', { name, email, password, passwordConfirm });
    if (data.token) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      resetAuthErrorState();
    }
    return data;
  },

  login: async (email, password) => {
    const { data } = await authAPI.post('/login', { email, password });
    if (data.token) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      resetAuthErrorState();
    }
    return data;
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  getProfile: async () => {
    const { data } = await authAPI.get('/profile');
    return data;
  },

  updateProfile: async (name, email) => {
    const { data } = await authAPI.put('/profile', { name, email });
    if (data.user) localStorage.setItem('user', JSON.stringify(data.user));
    return data;
  },

  // Returns a fresh token; store it so the current session stays signed in.
  changePassword: async (currentPassword, newPassword) => {
    const { data } = await authAPI.put('/password', { currentPassword, newPassword });
    if (data.token) {
      localStorage.setItem('token', data.token);
    }
    return data;
  },

  forgotPassword: async (email) => {
    const { data } = await authAPI.post('/forgot-password', { email });
    return data;
  },

  resetPassword: async (token, password, passwordConfirm) => {
    const { data } = await authAPI.post(`/reset-password/${token}`, { password, passwordConfirm });
    return data;
  },

  getCVStatus: async () => {
    const { data } = await authAPI.get('/cv-status');
    return data;
  },

  getStoredUser: () => {
    try {
      const u = localStorage.getItem('user');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  },

  getToken: () => localStorage.getItem('token'),

  isAuthenticated: () => !!localStorage.getItem('token'),
};

export const cvService = {
  uploadCV: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await cvAPI.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  parseCV: async (fileId) => {
    const { data } = await cvAPI.post(`/parse/${fileId}`);
    return data;
  },

  verifyCV: async (fileId, verifiedData) => {
    const { data } = await cvAPI.put('/verify', { file_id: fileId, verified_data: verifiedData });
    return data;
  },
};
