import { adminAPI } from './adminService.js';

// Admin → Professions & Skills (09c): the /api/admin/taxonomy pass-through to AIServices.
// Every call resolves to the response body ({ success, data, ... }); errors are axios errors
// (see pages/admin/taxonomy/taxonomyErrors.js for the messages shown).

const T = '/taxonomy';
const enc = encodeURIComponent;
const body = (r) => r.data;

export const taxonomyService = {
  getSources: () => adminAPI.get(`${T}/sources`).then(body),
  getLock: () => adminAPI.get(`${T}/lock`).then(body),

  // Import jobs
  listJobs: (params) => adminAPI.get(`${T}/jobs`, { params }).then(body),
  getJob: (id) => adminAPI.get(`${T}/jobs/${enc(id)}`).then(body),
  getDiff: (id, section, page = 1, limit = 50) =>
    adminAPI.get(`${T}/jobs/${enc(id)}/diff`, { params: { section, page, limit } }).then(body),
  upload: ({ source, datasetVersion, files }, onProgress) => {
    const form = new FormData();
    form.append('source', source);
    form.append('dataset_version', datasetVersion);
    for (const file of files) form.append('files', file, file.name);
    return adminAPI
      .post(`${T}/jobs`, form, {
        timeout: 5 * 60 * 1000,
        onUploadProgress: (e) => onProgress?.(e.total ? e.loaded / e.total : 0),
      })
      .then(body);
  },
  preview: (id) => adminAPI.post(`${T}/jobs/${enc(id)}/preview`, {}).then(body),
  cancel: (id) => adminAPI.post(`${T}/jobs/${enc(id)}/cancel`, {}).then(body),
  publish: (id, acknowledgeBackgroundWarning) =>
    adminAPI
      .post(`${T}/jobs/${enc(id)}/publish`, { acknowledge_background_warning: Boolean(acknowledgeBackgroundWarning) })
      .then(body),

  // Snapshots and restores
  listSnapshots: (pool) => adminAPI.get(`${T}/snapshots`, { params: pool ? { pool } : {} }).then(body),
  getSnapshot: (id) => adminAPI.get(`${T}/snapshots/${enc(id)}`).then(body),
  restore: (id) => adminAPI.post(`${T}/snapshots/${enc(id)}/restore`, {}).then(body),
  listRestores: () => adminAPI.get(`${T}/restores`).then(body),
  getRestore: (id) => adminAPI.get(`${T}/restores/${enc(id)}`).then(body),

  // Professions (admin overrides)
  listProfessions: (params) => adminAPI.get(`${T}/professions`, { params }).then(body),
  getProfession: (id) => adminAPI.get(`${T}/professions/${enc(id)}`).then(body),
  editProfession: (id, changes) => adminAPI.patch(`${T}/professions/${enc(id)}`, changes).then(body),
  resetProfession: (id, fields) =>
    adminAPI.post(`${T}/professions/${enc(id)}/reset`, fields ? { fields } : {}).then(body),

  // Skill taxonomy
  listSkills: (params) => adminAPI.get(`${T}/skills`, { params }).then(body),
  validateSkill: (change, create = false) => adminAPI.post(`${T}/skills/validate`, { ...change, create }).then(body),
  createSkill: (skill) => adminAPI.post(`${T}/skills`, skill).then(body),
  updateSkill: (name, changes) => adminAPI.put(`${T}/skills/${enc(name)}`, changes).then(body),
};
