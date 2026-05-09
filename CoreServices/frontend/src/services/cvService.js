const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

const getAuthToken = () => localStorage.getItem('token');

export const uploadCV = async (file) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/api/cv/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to upload CV');
  }
  return response.json();
};

export const parseCV = async (fileId) => {
  const response = await fetch(`${API_BASE_URL}/api/cv/parse/${fileId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to parse CV');
  }

  const payload = await response.json();
  return payload.parsed_data ?? payload;
};

export const verifyCVData = async (fileId, verifiedData) => {
  const response = await fetch(`${API_BASE_URL}/api/cv/verify`, {
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
    const error = await response.json();
    throw new Error(error.message || 'Failed to save CV data');
  }
  return response.json();
};

export const cvService = { uploadCV, parseCV, verifyCVData };
export default cvService;
