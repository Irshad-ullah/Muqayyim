import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, GraduationCap } from 'lucide-react';
import Navbar from '../components/Navbar.jsx';
import { learningPathService } from '../services/learningPathService.js';
import { errorView, progressText } from './learning/pathRules.js';
import { SOURCE_NAMES } from './careers/careerRules.js';

// Module 6: the user's learning paths with their progress (FR8.6, FR8.7). New paths are created from a career's
// details on the Career Matches page.

export default function LearningPathsPage() {
  const [state, setState] = useState({ kind: 'loading' });

  useEffect(() => {
    learningPathService.list()
      .then((paths) => setState({ kind: 'ready', paths }))
      .catch((err) => setState({ kind: 'error', view: errorView(err) }));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-5">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-indigo-600" aria-hidden="true" /> Learning paths
        </h1>
        {state.kind === 'loading' && <p className="text-sm text-slate-500" role="status">Loading…</p>}
        {state.kind === 'error' && (
          <div className="card p-6" role="alert"><strong>{state.view.title}.</strong> {state.view.message}</div>
        )}
        {state.kind === 'ready' && state.paths.length === 0 && (
          <div className="card p-8 text-center space-y-2" data-testid="no-paths">
            <p className="text-slate-700">You have no learning paths yet.</p>
            <p className="text-sm text-slate-500">Open a career on the <Link to="/career-matches" className="text-indigo-700 underline">Career Matches</Link> page and choose “Generate learning path”.</p>
          </div>
        )}
        {state.kind === 'ready' && state.paths.length > 0 && (
          <ul className="space-y-3">
            {state.paths.map((p) => (
              <li key={p.id}>
                <Link to={`/learning-paths/${p.id}`} className="card p-4 block hover:border-indigo-300" data-testid="path-row">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{p.title}</span>
                    <span className="text-xs text-slate-500">{SOURCE_NAMES[p.source] || p.source}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100}
                    aria-valuenow={p.progress.percent} aria-label={`${p.title} progress`}>
                    <div className="h-full bg-emerald-500" style={{ width: `${p.progress.percent}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{progressText(p.progress)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
