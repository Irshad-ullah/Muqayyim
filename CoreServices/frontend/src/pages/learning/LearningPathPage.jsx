import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ExternalLink, Sparkles, Zap } from 'lucide-react';
import Navbar from '../../components/Navbar.jsx';
import { learningPathService } from '../../services/learningPathService.js';
import { STATUS_VIEW, errorView, hoursText, moreText, progressText, timeline, weeksText } from './pathRules.js';

// Module 6 (FR8.2–FR8.8): one saved learning path — progress, the week-by-week timeline, the modules in order with
// their status, and a details panel (why, sub-topics, practice project, estimated hours, AI recommendations with a
// search link per platform). Completing a module adds the skill to the profile as "completed in your learning path
// (not verified)", which refreshes the career matches.

function Recommendation({ rec }) {
  return (
    <li className="rounded-lg border border-slate-200 p-3 text-sm" data-testid="recommendation">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-800">{rec.title}</span>
        <span className="text-xs text-slate-500">{rec.platform}{rec.instructor ? ` · ${rec.instructor}` : ''}</span>
      </div>
      {rec.description && <p className="text-xs text-slate-600 mt-1">{rec.description}</p>}
      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
        <span className={`text-[11px] rounded px-1.5 py-0.5 ${rec.free ? 'bg-violet-50 text-violet-800' : 'bg-amber-50 text-amber-800'}`}
          data-testid="rec-label">
          <Sparkles className="inline w-3 h-3 mr-1" aria-hidden="true" />{rec.label} · {rec.free ? 'free' : 'paid'} · {rec.language}
        </span>
        <a href={rec.searchUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-700 inline-flex items-center gap-1">
          {rec.searchLabel} <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </div>
    </li>
  );
}

function ModuleDetails({ module, busy, onStatus }) {
  return (
    <section className="card p-5 space-y-3" aria-label={`${module.skill} details`} data-testid="module-details">
      <h3 className="font-semibold text-slate-900">{module.order}. {module.skill}</h3>
      {module.quickWin && module.hint?.skill && (
        <p className="text-xs text-sky-700 flex items-center gap-1"><Zap className="w-3 h-3" aria-hidden="true" />
          Quick win: close to your {module.hint.skill}</p>
      )}
      {module.why && <p className="text-sm text-slate-700">{module.why}</p>}
      {module.subtopics?.length > 0 && (
        <div><h4 className="text-xs font-semibold uppercase text-slate-500">Sub-topics</h4>
          <ol className="list-decimal list-inside text-sm text-slate-700">{module.subtopics.map((s) => <li key={s}>{s}</li>)}</ol></div>
      )}
      {module.project && <p className="text-sm text-slate-700"><strong>Practice project:</strong> {module.project}</p>}
      <p className="text-xs text-slate-500">{hoursText(module.hours)}</p>
      {module.recommendations?.length > 0 && (
        <div><h4 className="text-xs font-semibold uppercase text-slate-500">Resources</h4>
          <ul className="space-y-2 mt-1">{module.recommendations.map((r) => <Recommendation key={r.title} rec={r} />)}</ul></div>
      )}
      <div className="flex gap-2 flex-wrap">
        {module.status !== 'in_progress' && module.status !== 'completed' && (
          <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => onStatus('in_progress')}>Start</button>
        )}
        {module.status !== 'completed' ? (
          <button type="button" className="btn-primary text-sm inline-flex items-center gap-1" disabled={busy} onClick={() => onStatus('completed')}>
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Mark completed
          </button>
        ) : (
          <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => onStatus('in_progress')}>Not completed yet</button>
        )}
      </div>
      {module.status === 'completed' && (
        <p className="text-xs text-emerald-700">{module.skill} is now in your profile as “completed in your learning path (not verified)”.</p>
      )}
    </section>
  );
}

export default function LearningPathPage() {
  const { id } = useParams();
  const [state, setState] = useState({ kind: 'loading' });
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    learningPathService.get(id)
      .then((path) => { setState({ kind: 'ready', path }); setSelected(path.modules[0]?.key || null); })
      .catch((err) => setState({ kind: 'error', view: errorView(err) }));
  }, [id]);

  const setStatus = async (key, status) => {
    setBusy(true);
    setError(null);
    try {
      setState({ kind: 'ready', path: await learningPathService.setStatus(id, key, status) });
    } catch (err) {
      setError(errorView(err));
    } finally {
      setBusy(false);
    }
  };

  const path = state.path;
  const module = path?.modules.find((m) => m.key === selected);
  const weeks = path ? timeline(path.modules, path.preferences?.hoursPerWeek) : [];
  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-5">
        <div className="flex gap-4 text-sm">
          <Link to="/dashboard" className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to dashboard</Link>
          <Link to="/learning-paths" className="text-slate-500 hover:text-slate-700">All learning paths</Link>
        </div>
        {state.kind === 'loading' && <p className="text-sm text-slate-500" role="status">Loading…</p>}
        {state.kind === 'error' && <div className="card p-6" role="alert"><strong>{state.view.title}.</strong> {state.view.message}</div>}
        {path && (
          <>
            <header className="space-y-2">
              <h1 className="text-2xl font-bold text-slate-900">Learning path: {path.title}</h1>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={path.progress.percent} aria-label="Path progress">
                <div className="h-full bg-emerald-500" style={{ width: `${path.progress.percent}%` }} />
              </div>
              <p className="text-sm text-slate-600" data-testid="path-progress">
                {progressText(path.progress)}{weeksText(path.modules, path.preferences?.hoursPerWeek) && ` · ${weeksText(path.modules, path.preferences.hoursPerWeek)}`}
              </p>
              {path.enrichment?.status !== 'enriched' && (
                <p className="text-xs text-amber-800 bg-amber-50 rounded p-2" data-testid="no-enrichment">
                  AI descriptions and resources are not available for this path right now; the modules and their order are complete.
                </p>
              )}
              {moreText(path.more) && <p className="text-xs text-slate-500" data-testid="more-skills">{moreText(path.more)}</p>}
            </header>
            {error && <p className="text-sm text-red-700" role="alert"><strong>{error.title}.</strong> {error.message}</p>}
            <div className="grid lg:grid-cols-2 gap-5">
              <div className="space-y-4">
                <ol className="card divide-y divide-slate-100" aria-label="Modules">
                  {path.modules.map((m) => (
                    <li key={m.key}>
                      <button type="button" onClick={() => setSelected(m.key)} data-testid="module-row" aria-current={m.key === selected ? 'true' : undefined}
                        className={`w-full text-left px-4 py-3 flex items-center justify-between gap-2 ${m.key === selected ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                        <span className="text-sm text-slate-800">{m.order}. {m.skill}
                          {m.quickWin && <span className="ml-2 text-[11px] text-sky-700 bg-sky-50 rounded px-1">quick win</span>}
                          <span className="ml-2 text-[11px] text-slate-500">{m.tier}</span>
                        </span>
                        <span className={`text-[11px] rounded px-1.5 py-0.5 ${STATUS_VIEW[m.status].tone}`} data-testid="module-status">{STATUS_VIEW[m.status].label}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                {weeks.length > 0 && (
                  <section className="card p-4" aria-label="Timeline" data-testid="timeline">
                    <h2 className="text-sm font-semibold text-slate-700 mb-2">Week by week ({path.preferences.hoursPerWeek} h per week)</h2>
                    <ol className="space-y-1 text-sm">{weeks.map((w) => (
                      <li key={w.week}><strong>Week {w.week}:</strong> {w.items.map((i) => `${i.skill} (${i.hours} h)`).join(', ')}</li>
                    ))}</ol>
                  </section>
                )}
              </div>
              {module && <ModuleDetails module={module} busy={busy} onStatus={(status) => setStatus(module.key, status)} />}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
