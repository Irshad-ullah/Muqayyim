// Module 4 — CV Generator API (CoreServices via the API Gateway).
import { apiFetch } from './apiErrors.js';

import { API_BASE_URL as API_BASE } from '../config/api.js';
const token = () => localStorage.getItem("token");

const authHeaders = (json = false) => {
  const h = { Authorization: `Bearer ${token()}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
};

const request = async (path, options = {}, fallback = "Request failed") => {
  const res = await apiFetch(`${API_BASE}/api/generated-cvs${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || fallback);
  return body;
};

// Normalized CV content built from the user's Profile Builder + parsed CV data.
export const getCvSource = () =>
  request("/source", { headers: authHeaders() }, "Failed to load your profile data");

export const listCvs = () =>
  request("", { headers: authHeaders() }, "Failed to load saved CVs");

export const getCv = (id) =>
  request(`/${id}`, { headers: authHeaders() }, "Failed to load CV");

export const createCv = (cv) =>
  request(
    "",
    { method: "POST", headers: authHeaders(true), body: JSON.stringify(cv) },
    "Failed to save CV",
  );

export const updateCv = (id, cv) =>
  request(
    `/${id}`,
    { method: "PUT", headers: authHeaders(true), body: JSON.stringify(cv) },
    "Failed to update CV",
  );

export const deleteCv = (id) =>
  request(`/${id}`, { method: "DELETE", headers: authHeaders() }, "Failed to delete CV");

export const cvGeneratorService = {
  getCvSource,
  listCvs,
  getCv,
  createCv,
  updateCv,
  deleteCv,
};
export default cvGeneratorService;
