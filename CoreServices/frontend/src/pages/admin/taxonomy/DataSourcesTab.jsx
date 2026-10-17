import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Database, Upload } from 'lucide-react';
import { taxonomyService } from '../../../services/taxonomyService.js';
import { ATTRIBUTION, ErrorBox, Loading, btn, card, input } from './components.jsx';
import { checkUploadFiles, formatBytes, formatTime, taxonomyError } from './taxonomyRules.js';

// Data sources: what is loaded now, and the upload of a new O*NET, curated-roles or ESCO release.
// Module 5.2: ESCO is retired (replaced by the curated modern roles); while retired its upload is disabled with the
// explanation, and re-enabling it means restoring the snapshot taken before the retirement (History tab).

export const SOURCE_HINTS = {
  onet:
    'Download each table as CSV from onetcenter.org/database.html: occupation_data.csv, job_titles.csv, software_skills.csv',
  esco:
    'Upload the ESCO classification CSV ZIP (English), or the required CSVs: occupations_en.csv, skills_en.csv, occupationSkillRelations_en.csv (digitalSkillsCollection_en.csv is optional)',
  curated:
    'Upload the curated dataset file modern_roles_v1.json; the version must match the file. Every skill must be in the skill list',
};
const DEFAULT_VERSION = { onet: 'O*NET 31.0', esco: 'ESCO v1.2.1', curated: '1.0.0' };
const NAMES = { onet: 'O*NET', esco: 'ESCO', curated: 'Curated modern roles' };
const ACCEPT = { onet: '.zip,.csv', esco: '.zip,.csv', curated: '.json' };

function SourceCard({ name, info }) {
  return (
    <div className={`${card} p-5`} data-testid={`source-${name}`}>
      <div className="flex items-center gap-2 mb-3">
        <Database className="w-4 h-4 text-indigo-600" />
        <h3 className="font-semibold text-slate-800">{NAMES[name]}</h3>
        <span className="text-xs text-slate-400">{info.versions?.length ? info.versions.join(', ') : 'not loaded'}</span>
        {info.retired && (
          <span className="text-xs font-semibold text-amber-800 bg-amber-100 rounded px-1.5 py-0.5" data-testid="retired-badge">Retired</span>
        )}
      </div>
      {info.retired && (
        <p className="mb-3 text-xs text-amber-800" data-testid="retired-note">
          {info.retired_message}
          {info.retirement?.snapshot_id && <> Snapshot to restore: <code>{info.retirement.snapshot_id}</code>.</>}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-slate-500">Professions</dt>
        <dd className="text-slate-800">
          {info.professions} ({info.active} active)
        </dd>
        {name === 'esco' && (
          <>
            <dt className="text-slate-500">ESCO skills</dt>
            <dd className="text-slate-800">{info.esco_skills ?? '—'}</dd>
          </>
        )}
        <dt className="text-slate-500">Last updated</dt>
        <dd className="text-slate-800">{formatTime(info.last_updated)}</dd>
        <dt className="text-slate-500">Last import</dt>
        <dd className="text-slate-800">
          {info.last_published_job
            ? `${info.last_published_job.dataset_version} by ${info.last_published_job.created_by}, ${formatTime(info.last_published_job.updated_at)}`
            : 'none through the admin panel'}
        </dd>
      </dl>
      <p className="mt-3 text-xs text-slate-500">{info.attribution || ATTRIBUTION[name]}</p>
    </div>
  );
}

export default function DataSourcesTab({ lock, onUploaded }) {
  const [sources, setSources] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [source, setSource] = useState('onet');
  const [version, setVersion] = useState(DEFAULT_VERSION.onet);
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await taxonomyService.getSources();
      setSources(res.data);
    } catch (err) {
      setLoadError(taxonomyError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fileProblem = files.length ? checkUploadFiles(files, source) : null;
  const retired = Boolean(sources?.[source]?.retired);
  const uploading = progress !== null;

  const submit = async (e) => {
    e.preventDefault();
    const problem = checkUploadFiles(files, source);
    if (problem) {
      setError({ title: 'Check the files', message: problem, details: [] });
      return;
    }
    setError(null);
    setProgress(0);
    try {
      const res = await taxonomyService.upload({ source, datasetVersion: version.trim(), files }, setProgress);
      toast.success('Upload received — validating the files');
      setFiles([]);
      e.target.reset?.();
      onUploaded?.(res.data);
    } catch (err) {
      setError(taxonomyError(err));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="space-y-5">
      {loading ? (
        <Loading />
      ) : loadError ? (
        <ErrorBox error={loadError} />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <SourceCard name="onet" info={sources.onet} />
          {sources.curated && <SourceCard name="curated" info={sources.curated} />}
          <SourceCard name="esco" info={sources.esco} />
          {sources.manual?.professions > 0 && (
            <p className="text-sm text-slate-500 md:col-span-2">
              Manual professions: {sources.manual.professions} ({sources.manual.active} active).
            </p>
          )}
        </div>
      )}

      <form onSubmit={submit} className={`${card} p-5 space-y-4`} aria-label="Upload a dataset">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <Upload className="w-4 h-4 text-indigo-600" /> Upload a new release
        </h3>
        <ErrorBox error={error} onDismiss={() => setError(null)} />
        <div className="grid md:grid-cols-3 gap-3">
          <label className="text-sm text-slate-600">
            Source
            <select
              className={`${input} mt-1`}
              value={source}
              disabled={uploading}
              onChange={(e) => {
                setSource(e.target.value);
                setVersion(DEFAULT_VERSION[e.target.value]);
              }}
            >
              <option value="onet">O*NET</option>
              <option value="curated">Curated modern roles</option>
              <option value="esco" disabled={Boolean(sources?.esco?.retired)}>
                {sources?.esco?.retired ? 'ESCO (retired)' : 'ESCO'}
              </option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            Dataset version
            <input className={`${input} mt-1`} value={version} maxLength={100} disabled={uploading} onChange={(e) => setVersion(e.target.value)} />
          </label>
          <label className="text-sm text-slate-600">
            Files
            <input
              type="file"
              multiple
              accept={ACCEPT[source]}
              aria-label="Files"
              disabled={uploading}
              className="mt-1 block w-full text-sm text-slate-600"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
        </div>
        <p className="text-xs text-slate-500" data-testid="source-hint">
          {SOURCE_HINTS[source]}. Only these files are read; anything else in a ZIP is ignored. Limit 100 MB.
        </p>
        {files.length > 0 && (
          <p className="text-xs text-slate-500">
            {files.length} file(s), {formatBytes(files.reduce((s, f) => s + f.size, 0))}
          </p>
        )}
        {fileProblem && <p className="text-sm text-red-700">{fileProblem}</p>}
        {retired && <p className="text-sm text-amber-800" data-testid="upload-retired">{sources[source].retired_message}</p>}
        {uploading && (
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <button
          type="submit"
          className={btn.primary}
          disabled={uploading || Boolean(lock) || retired || !files.length || Boolean(fileProblem) || !version.trim()}
        >
          {uploading ? `Uploading… ${Math.round(progress * 100)}%` : 'Upload and validate'}
        </button>
      </form>

      <div className="text-xs text-slate-500 space-y-1" data-testid="attribution">
        <p>{ATTRIBUTION.onet}</p>
        <p>{ATTRIBUTION.curated}</p>
        <p>{ATTRIBUTION.esco}</p>
      </div>
    </div>
  );
}
