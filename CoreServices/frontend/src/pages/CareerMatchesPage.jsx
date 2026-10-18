import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Compass, FileUp, Info, PenSquare, RefreshCw } from 'lucide-react';
import Navbar from '../components/Navbar.jsx';
import { careerMatchService } from '../services/careerMatchService.js';
import usePolling from './admin/taxonomy/usePolling.js';
import CareerDetails, { SourceBadge } from './careers/CareerDetails.jsx';
import {
  ESCO_NOTE,
  SORTS,
  SOURCE_NAMES,
  categoriesOf,
  categoryOptions,
  countsText,
  errorView,
  formatScore,
  sourceOptions,
  sourcesOf,
  visibleResults,
} from './careers/careerRules.js';

// Module 5 — Semantic Career Matching (Mockup M6): ranked careers on the left, the selected
// career's skills, explanation and sources on the right (below on narrow screens).
// Sorting and filtering happen in the browser on the already-loaded list (instant, FR7.8).

export const PENDING_POLL_MS = 5000;

function StateBox({ icon: Icon = AlertTriangle, title, children, testId }) {
  return (
    <div className="card p-8 text-center space-y-3" role="status" data-testid={testId}>
      <Icon className="w-8 h-8 mx-auto text-indigo-500" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="text-sm text-slate-600 space-y-3">{children}</div>
    </div>
  );
}

function ResultItem({ result, selected, onSelect, buttonRef, scoringMode }) {
  return (
    <li>
      <button
        ref={buttonRef}
        type="button"
        data-testid="career-row"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(result.profession_id)}
        className={`w-full text-left px-4 py-3 border-b border-slate-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-400 ${
          selected ? 'bg-indigo-50' : 'hover:bg-slate-50'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm font-medium text-slate-900">{result.title}</span>
          <span className="text-sm font-bold text-indigo-700 whitespace-nowrap">{formatScore(result.score)}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 flex-wrap text-xs text-slate-500">
          {sourcesOf(result).map((s) => <SourceBadge key={s} source={s} />)}
          {/* Not a button: the row itself is one. The details panel has the focusable tooltip. */}
          {sourcesOf(result).length === 1 && sourcesOf(result)[0] === 'esco' && (
            <span title={ESCO_NOTE} aria-hidden="true" data-testid="esco-hint" className="inline-flex">
              <Info className="w-3.5 h-3.5 text-slate-400" />
            </span>
          )}
          <span>{categoriesOf(result).join(' / ')}</span>
          <span aria-hidden="true">·</span>
          <span>{countsText(result, scoringMode)}</span>
        </div>
      </button>
    </li>
  );
}

export default function CareerMatchesPage() {
  const [state, setState] = useState({ kind: 'loading' });
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ sort: 'score_desc', category: '', source: '', minScore: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState({ kind: 'idle' });
  const buttons = useRef({});
  const detailsRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const result = await careerMatchService.getMatches();
      setData(result);
      setState({ kind: result.state === 'no_skills' ? 'no_skills' : 'ready' });
    } catch (error) {
      setState(errorView(error));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // EMBEDDINGS_PENDING only: check again every 5 s while the tab is visible.
  usePolling(load, state.kind === 'pending', PENDING_POLL_MS);

  const { shown, extra } = useMemo(() => visibleResults(data?.results, filters), [data, filters]);
  const ordered = useMemo(() => [...shown, ...extra], [shown, extra]);

  // The selected career, or the first visible one when there is no (still visible) choice.
  // Derived during render, so a visible career is always selected — no empty first frame.
  const activeId = ordered.some((r) => r.profession_id === selectedId) ? selectedId : ordered[0]?.profession_id;

  useEffect(() => {
    if (!activeId) return undefined;
    let cancelled = false;
    setDetail({ kind: 'loading' });
    careerMatchService.getMatch(activeId).then(
      (result) => !cancelled && setDetail({ kind: 'ready', data: result }),
      (error) => !cancelled && setDetail(errorView(error)),
    );
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const select = (id) => {
    setSelectedId(id);
    // Narrow screens: the details are below the list.
    if (typeof window !== 'undefined' && window.innerWidth < 1024) detailsRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  };

  // Keyboard: ↑/↓ (and Home/End) move through the list and select.
  const onListKey = (event) => {
    const keys = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity };
    if (!(event.key in keys) || !ordered.length) return;
    event.preventDefault();
    const index = ordered.findIndex((r) => r.profession_id === activeId);
    const step = keys[event.key];
    const next = Number.isFinite(step) ? Math.min(ordered.length - 1, Math.max(0, index + step)) : step < 0 ? 0 : ordered.length - 1;
    const id = ordered[next].profession_id;
    setSelectedId(id);
    buttons.current[id]?.focus();
  };

  const setFilter = (key) => (event) => setFilters((f) => ({ ...f, [key]: key === 'minScore' ? Number(event.target.value) : event.target.value }));
  const categories = categoryOptions(data?.results);
  const sources = sourceOptions(data?.results);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="pt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <Compass className="w-6 h-6 text-indigo-600" aria-hidden="true" /> Career matches
              </h1>
              <p className="text-sm text-slate-500">IT careers ranked by how many of their key skills you already have.</p>
            </div>
            <Link to="/dashboard" className="btn-secondary text-sm inline-flex items-center gap-2" data-testid="dashboard-link">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to dashboard
            </Link>
          </div>

          {state.kind === 'loading' && (
            <StateBox icon={RefreshCw} title="Finding your career matches…" testId="state-loading" />
          )}

          {state.kind === 'no_skills' && (
            <StateBox icon={Compass} title="Add your skills to see career matches" testId="state-no-skills">
              <p>Career matching compares the skills in your profile with the skills each IT career needs.</p>
              <div className="flex justify-center gap-3 flex-wrap">
                <Link to="/profile-builder" className="btn-primary text-sm inline-flex items-center gap-2">
                  <PenSquare className="w-4 h-4" aria-hidden="true" /> Open the Profile Builder
                </Link>
                <Link to="/cv-parsing" className="btn-secondary text-sm inline-flex items-center gap-2">
                  <FileUp className="w-4 h-4" aria-hidden="true" /> Upload your CV
                </Link>
              </div>
            </StateBox>
          )}

          {!['loading', 'no_skills', 'ready'].includes(state.kind) && (
            <StateBox title={state.title} testId={`state-${state.kind}`}>
              <p>{state.message}</p>
              {state.poll && <p className="text-xs text-slate-400">Checking again every 5 seconds…</p>}
              <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2" onClick={() => { setState({ kind: 'loading' }); load(); }}>
                <RefreshCw className="w-4 h-4" aria-hidden="true" /> {state.poll ? 'Check now' : 'Try again'}
              </button>
            </StateBox>
          )}

          {state.kind === 'ready' && data && (
            <>
              {data.unverified_skill_count > 0 && (
                <p className="text-xs text-slate-600" role="note" data-testid="unverified-note">
                  These matches include {data.unverified_skill_count} unverified skill{data.unverified_skill_count === 1 ? '' : 's'} from your completed learning modules.
                </p>
              )}
              {data.low_match && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="note" data-testid="low-match">
                  Your current skills don&apos;t closely match the IT careers in our database (best match {formatScore(data.best_score)}).
                  Adding more of your technical skills to your profile will make these results more useful.
                </div>
              )}

              <div className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end" aria-label="Sort and filter">
                <label className="text-sm text-slate-600">
                  Sort by
                  <select className="input-field mt-1" value={filters.sort} onChange={setFilter('sort')}>
                    {Object.entries(SORTS).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </label>
                <label className="text-sm text-slate-600">
                  Category
                  <select className="input-field mt-1" value={filters.category} onChange={setFilter('category')}>
                    <option value="">All categories</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="text-sm text-slate-600">
                  Source
                  <select className="input-field mt-1" value={filters.source} onChange={setFilter('source')}>
                    <option value="">All sources</option>
                    {sources.map((s) => <option key={s} value={s}>{SOURCE_NAMES[s] || s}</option>)}
                  </select>
                </label>
                <label className="text-sm text-slate-600">
                  Minimum match: {filters.minScore}%
                  <input type="range" min="0" max="100" step="5" className="w-full mt-2" value={filters.minScore}
                    onChange={setFilter('minScore')} aria-valuetext={`${filters.minScore}%`} />
                </label>
              </div>

              <div className="grid lg:grid-cols-5 gap-6 items-start">
                <section className="lg:col-span-2 card overflow-hidden" aria-labelledby="career-list-title">
                  <h2 id="career-list-title" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-100">
                    {shown.length} career{shown.length === 1 ? '' : 's'} · use ↑ ↓ to move
                  </h2>
                  <ul onKeyDown={onListKey} aria-label="Career matches" data-testid="career-list">
                    {shown.map((r) => (
                      <ResultItem key={r.profession_id} result={r} scoringMode={data.scoring_mode} selected={r.profession_id === activeId} onSelect={select}
                        buttonRef={(el) => { buttons.current[r.profession_id] = el; }} />
                    ))}
                  </ul>
                  {extra.length > 0 && (
                    <>
                      <p className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-y border-slate-100" data-testid="extra-note">
                        {shown.length === 0 ? 'No careers match these filters.' : `Only ${shown.length} match these filters.`} Your closest other careers:
                      </p>
                      <ul onKeyDown={onListKey} aria-label="Closest other careers" data-testid="extra-list">
                        {extra.map((r) => (
                          <ResultItem key={r.profession_id} result={r} scoringMode={data.scoring_mode} selected={r.profession_id === activeId} onSelect={select}
                            buttonRef={(el) => { buttons.current[r.profession_id] = el; }} />
                        ))}
                      </ul>
                    </>
                  )}
                </section>

                <div className="lg:col-span-3" ref={detailsRef}>
                  {detail.kind === 'loading' && <StateBox icon={RefreshCw} title="Loading details…" testId="detail-loading" />}
                  {detail.kind === 'ready' && <CareerDetails detail={detail.data} />}
                  {!['idle', 'loading', 'ready'].includes(detail.kind) && (
                    <StateBox title={detail.title} testId="detail-error"><p>{detail.message}</p></StateBox>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
