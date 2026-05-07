/**
 * CV Service
 * Handles all API calls for CV parsing, uploading, and verification
 * FE-2, FE-3, FE-4: Integration with backend endpoints
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * Get auth token.
 * Priority: shared localhost cookie (set by Module 1) → localStorage fallback.
 * Cookies on localhost are shared across all ports, making this the only
 * reliable bridge between Module 1 (port 5174) and Module 2 (port 5173).
 */
const getAuthToken = () => {
  const match = document.cookie.match(/(?:^|;\s*)muqayyim_jwt=([^;]+)/);
  return match ? match[1] : localStorage.getItem('authToken');
};

/**
 * Upload CV file to server
 * POST /api/cv/upload
 */
export const uploadCV = async (file) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/api/cv/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAuthToken()}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to upload CV');
  }

  return response.json();
};

/**
 * Parse uploaded CV using NLP
 * POST /api/cv/parse/{file_id}
 * FE-2: NLP Parsing - Extract skills, education, experience
 */
export const parseCV = async (fileId) => {
  const response = await fetch(`${API_BASE_URL}/api/cv/parse/${fileId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAuthToken()}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to parse CV');
  }

  const payload = await response.json();
  // Backend returns { file_id, parsing_status, parsed_data, message }.
  // Frontend expects the plain parsed_data object.
  return payload.parsed_data ?? payload;
};

/**
 * Save verified data to user profile
 * PUT /api/cv/verify
 * FE-4: Store in User Profile
 */
export const verifyCVData = async (fileId, verifiedData) => {
  const response = await fetch(`${API_BASE_URL}/api/cv/verify`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${getAuthToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_id: fileId,
      // Allow passing either the full parse payload or just the parsed data.
      verified_data: verifiedData?.parsed_data ?? verifiedData,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to save CV data');
  }

  return response.json();
};

/**
 * Get parsed CV summary for user
 * GET /api/cv/summary/{user_id}
 */
export const getCVSummary = async (userId) => {
  const response = await fetch(`${API_BASE_URL}/api/cv/summary/${userId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${getAuthToken()}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch CV summary');
  }

  return response.json();
};

/**
 * Export service object
 */
export const cvService = {
  uploadCV,
  parseCV,
  verifyCVData,
  getCVSummary,
};

export default cvService;
