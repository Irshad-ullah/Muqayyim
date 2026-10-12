import { apiFetch, apiError } from './apiErrors.js';
import { API_BASE_URL } from '../config/api.js';

const getAuthToken = () => localStorage.getItem('token');

export const uploadCV = async (file) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiFetch(`${API_BASE_URL}/api/cv/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw apiError(response, body, 'Failed to upload CV');
  }
  return response.json();
};

export const parseCV = async (fileId) => {
  const response = await apiFetch(`${API_BASE_URL}/api/cv/parse/${fileId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw apiError(response, body, 'Failed to parse CV');
  }

  const payload = await response.json();
  return payload.parsed_data ?? payload;
};

export const verifyCVData = async (fileId, verifiedData) => {
  const response = await apiFetch(`${API_BASE_URL}/api/cv/verify`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_id: fileId,
      verified_data: verifiedData?.parsed_data ?? verifiedData,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw apiError(response, body, 'Failed to save CV data');
  }
  return response.json();
};

// Latest parsed CV for the logged-in user, served by AIServices (user from JWT).
// Returns { cvData, status, uploadDate } — cvData is null when nothing is parsed yet.
export const getLatestCV = async () => {
  const response = await apiFetch(`${API_BASE_URL}/api/cv/latest`, {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw apiError(response, body, 'Failed to fetch CV data');
  }
  return response.json();
};

export const cvService = { uploadCV, parseCV, verifyCVData, getLatestCV };
export default cvService;
