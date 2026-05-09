const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8080";
const token = () => localStorage.getItem("token");

const authHeaders = (json = false) => {
  const h = { Authorization: `Bearer ${token()}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
};

export const getProfile = async () => {
  const res = await fetch(`${API_BASE}/api/profile`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
};

export const saveProfile = async (data) => {
  const res = await fetch(`${API_BASE}/api/profile/save`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save profile");
  return res.json();
};

export const fetchGitHub = async (username) => {
  const res = await fetch(`${API_BASE}/api/profile/github`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({ username }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to fetch GitHub data");
  }
  return res.json();
};

// Fetch most recent parsed CV data for this user (read from AI Service's collection).
export const getCVData = async () => {
  const res = await fetch(`${API_BASE}/api/profile/cv-data`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch CV data");
  return res.json();
};

// Merge + deduplicate skills from all sources.
export const extractSkills = async (
  cvSkills = [],
  githubSkills = [],
  manualSkills = [],
) => {
  const res = await fetch(`${API_BASE}/api/profile/extract-skills`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({ cvSkills, githubSkills, manualSkills }),
  });
  if (!res.ok) throw new Error("Failed to extract skills");
  return res.json();
};

export const profileService = {
  getProfile,
  saveProfile,
  fetchGitHub,
  getCVData,
  extractSkills,
};
export default profileService;
