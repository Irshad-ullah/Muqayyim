import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const CV_SERVICE_URL = import.meta.env.VITE_CV_SERVICE_URL || 'http://localhost:8000';

export const authAPI = axios.create({
  baseURL: `${API_BASE_URL}/api/auth`,
});

export const cvAPI = axios.create({
  baseURL: `${CV_SERVICE_URL}/api/cv`,
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

// Cookies on localhost are shared across all ports (5174, 5173, 8080 …).
// This is the only reliable cross-origin token bridge for a local dev setup.
const COOKIE_NAME = 'muqayyim_jwt';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days — matches JWT_EXPIRE

const setTokenCookie = (token) => {
  document.cookie = `${COOKIE_NAME}=${token}; path=/; SameSite=Lax; max-age=${COOKIE_MAX_AGE}`;
};

const clearTokenCookie = () => {
  document.cookie = `${COOKIE_NAME}=; path=/; SameSite=Lax; max-age=0`;
};

export const authService = {
  register: async (name, email, password, passwordConfirm) => {
    const { data } = await authAPI.post('/register', { name, email, password, passwordConfirm });
    if (data.token) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setTokenCookie(data.token);
    }
    return data;
  },

  login: async (email, password) => {
    const { data } = await authAPI.post('/login', { email, password });
    if (data.token) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setTokenCookie(data.token);
    }
    return data;
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    clearTokenCookie();
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

  updateCVStatus: async (cvStatus) => {
    const { data } = await authAPI.patch('/cv-status', { cvStatus });
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
