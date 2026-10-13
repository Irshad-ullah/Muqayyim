import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { embeddingService } from '../../services/embeddingService.js';
import SkillMap from './SkillMap.jsx';

// "Skill embeddings" status card + "Skill map" (Module 2 FE-4/FE-5).
// Each skill has its own vector; nothing is averaged or weighted.

const STATUS = {
  ready: { label: 'Ready', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  pending: { label: 'Processing', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  none: { label: 'Not yet created', tone: 'bg-slate-50 text-slate-600 border-slate-200' },
};
const RETRY_MS = 4000;
const MAX_RETRY_MS = 30000;
const shortModel = (model) => (model || '').split('/').pop();

export default function SkillEmbeddingsCard({ retryMs = RETRY_MS, maxRetryMs = MAX_RETRY_MS }) {
  const [info, setInfo] = useState(null);
  const [infoError, setInfoError] = useState('');
  const [map, setMap] = useState(null);
  const [mapState, setMapState] = useState('loading'); // loading | ready | NOT_ENOUGH_SKILLS | EMBEDDINGS_PENDING | MODEL_LOADING | error
  const [mapMessage, setMapMessage] = useState('');
  const timer = useRef(null);
  const startedAt = useRef(0);

  const load = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const [status, mapResult] = await Promise.all([
        embeddingService.getMyEmbeddings(),
        embeddingService.getMySkillMap().then(
          (body) => ({ body }),
          (error) => ({ error }),
        ),
      ]);
      setInfo(status);
      setInfoError('');
      if (mapResult.body) {
        setMap(mapResult.body);
        setMapState('ready');
        return;
      }
      const { code, message } = mapResult.error || {};
      setMapMessage(message || '');
      const retryable = code === 'EMBEDDINGS_PENDING' || code === 'MODEL_LOADING';
      setMapState(retryable || code === 'NOT_ENOUGH_SKILLS' ? code : 'error');
      // Auto-retry while vectors are being created (at most ~30 s).
      if (retryable && Date.now() - startedAt.current < maxRetryMs) {
        timer.current = setTimeout(load, retryMs);
      }
    } catch (error) {
      setInfoError(error.message || 'Could not load your skill embeddings');
    }
  }, [retryMs, maxRetryMs]);

  useEffect(() => {
    startedAt.current = Date.now();
    load();
    return () => clearTimeout(timer.current);
  }, [load]);

  const retry = () => {
    startedAt.current = Date.now();
    setMapState('loading');
    load();
  };

  const status = STATUS[info?.status] || STATUS.none;

  return (
    <section className="card p-6 space-y-5" aria-labelledby="skill-embeddings-title" data-testid="skill-embeddings-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 id="skill-embeddings-title" className="text-base font-semibold text-slate-900">Skill embeddings</h3>
            <p className="text-xs text-slate-500">Each skill is turned into a vector that captures its meaning.</p>
          </div>
        </div>
        {info && (
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${status.tone}`} data-testid="embedding-status">
            {status.label}
          </span>
        )}
      </div>

      {infoError && <p className="text-sm text-red-600">{infoError}</p>}
      {info && info.status === 'none' && (
        <p className="text-sm text-slate-600">Embeddings are created when you add or update your skills.</p>
      )}
      {info && info.status !== 'none' && (
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Skills embedded</dt>
            <dd className="font-semibold text-slate-900" data-testid="skills-count">{info.skills_count}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Model</dt>
            <dd className="font-medium text-slate-800" title={info.model}>{shortModel(info.model)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Last updated</dt>
            <dd className="font-medium text-slate-800">{info.updated_at ? new Date(info.updated_at).toLocaleString() : '—'}</dd>
          </div>
        </dl>
      )}

      <div className="border-t border-slate-100 pt-4">
        <h4 className="text-sm font-semibold text-slate-800 mb-1">Skill map</h4>
        <p className="text-xs text-slate-500 mb-3">
          Related skills appear closer together. Positions are an approximate 2D view; similarity values are exact.
        </p>

        {mapState === 'loading' && <p className="text-sm text-slate-500">Loading your skill map…</p>}
        {mapState === 'NOT_ENOUGH_SKILLS' && (
          <p className="text-sm text-slate-600" data-testid="map-not-enough">
            {mapMessage || 'Add at least 3 skills to see your skill map.'}
          </p>
        )}
        {(mapState === 'EMBEDDINGS_PENDING' || mapState === 'MODEL_LOADING') && (
          <div className="flex items-center gap-2 text-sm text-amber-700" role="status" data-testid="map-pending">
            <RefreshCw className="w-4 h-4 animate-spin" />
            {mapState === 'MODEL_LOADING'
              ? 'The skill model is still starting up. Your map will appear shortly.'
              : 'Your skill embeddings are being created. Your map will appear shortly.'}
            <button type="button" onClick={retry} className="ml-2 text-xs font-medium text-indigo-600 hover:underline">
              Check again
            </button>
          </div>
        )}
        {mapState === 'error' && <p className="text-sm text-red-600">{mapMessage || 'Could not load your skill map.'}</p>}

        {mapState === 'ready' && map && (
          <div className="space-y-4">
            <SkillMap points={map.points} />
            <div>
              <h5 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Most closely related</h5>
              <ol className="space-y-1" data-testid="closest-pairs">
                {map.closestPairs.map((p) => (
                  <li key={`${p.a}|${p.b}`} className="flex items-center justify-between text-sm">
                    <span className="text-slate-800">
                      {p.a} <span className="text-slate-400">↔</span> {p.b}
                    </span>
                    <span className="font-mono text-slate-600">{p.similarity.toFixed(2)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
