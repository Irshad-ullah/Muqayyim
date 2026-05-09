import React, { useState, useEffect } from 'react';
import { Github, RefreshCw, Star, Check, Zap, ExternalLink } from 'lucide-react';

export default function GitHubForm({ githubData, selectedRepos, extractedSkills, onFetch, onApply }) {
  const [username, setUsername] = useState(githubData?.username || '');
  const [fetchedRepos, setFetchedRepos] = useState(githubData?.repos || []);
  const [fetchedSkills, setFetchedSkills] = useState(githubData?.extractedSkills || []);
  const [selectedIds, setSelectedIds] = useState(new Set((selectedRepos || []).map((r) => r.repoId)));
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (githubData?.username) setUsername(githubData.username);
    if (githubData?.repos?.length) setFetchedRepos(githubData.repos);
    if (githubData?.extractedSkills?.length) setFetchedSkills(githubData.extractedSkills);
  }, [githubData]);

  const handleFetch = async () => {
    if (!username.trim()) return;
    setLoading(true);
    setError('');
    setApplied(false);
    try {
      const result = await onFetch(username.trim());
      setFetchedRepos(result.repos);
      setFetchedSkills(result.extractedSkills);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err.message || 'Failed to fetch repositories');
    } finally {
      setLoading(false);
    }
  };

  const toggleRepo = (repoId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(repoId) ? next.delete(repoId) : next.add(repoId);
      return next;
    });
    setApplied(false);
  };

  const handleApply = () => {
    const selected = fetchedRepos
      .filter((r) => selectedIds.has(r.repoId))
      .map((r) => ({
        repoId:      r.repoId,
        name:        r.name,
        description: r.description,
        url:         r.url,
        languages:   r.language ? [r.language] : [],
        topics:      r.topics || [],
        stars:       r.stars,
      }));

    const skills = new Set();
    fetchedRepos.filter((r) => selectedIds.has(r.repoId)).forEach((r) => {
      if (r.language) skills.add(r.language);
      r.topics?.forEach((t) => skills.add(t));
    });

    onApply(selected, Array.from(skills).filter(Boolean));
    setApplied(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">GitHub Integration</h2>
        <p className="text-sm text-slate-500">
          Fetch your public repositories to auto-extract skills and showcase selected projects on your profile.
        </p>
      </div>

      {/* Username input */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Github className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
            placeholder="Enter your GitHub username"
            className="input-field pl-9"
          />
        </div>
        <button
          onClick={handleFetch}
          disabled={!username.trim() || loading}
          className="btn-primary flex items-center gap-2 flex-shrink-0"
        >
          {loading
            ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <RefreshCw className="w-4 h-4" />}
          {loading ? 'Fetching…' : 'Fetch Repos'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {/* Repo grid */}
      {fetchedRepos.length > 0 && (
        <>
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">
                {fetchedRepos.length} repositories — select to include in your profile
              </p>
              <div className="flex gap-3 text-xs">
                <button onClick={() => setSelectedIds(new Set(fetchedRepos.map((r) => r.repoId)))} className="text-indigo-600 hover:underline">Select all</button>
                <span className="text-slate-300">|</span>
                <button onClick={() => setSelectedIds(new Set())} className="text-slate-500 hover:underline">Clear</button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
              {fetchedRepos.map((repo) => {
                const sel = selectedIds.has(repo.repoId);
                return (
                  <button
                    key={repo.repoId}
                    onClick={() => toggleRepo(repo.repoId)}
                    className={`text-left p-3 rounded-xl border-2 transition-all ${
                      sel ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 text-sm truncate">{repo.name}</p>
                        {repo.description && (
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{repo.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {repo.language && (
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />
                              {repo.language}
                            </span>
                          )}
                          {repo.stars > 0 && (
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <Star className="w-3 h-3" />{repo.stars}
                            </span>
                          )}
                          {!repo.fork && (
                            <a href={repo.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-indigo-500 hover:underline flex items-center gap-0.5">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        {repo.topics?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {repo.topics.slice(0, 4).map((t) => (
                              <span key={t} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all mt-0.5 ${
                        sel ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'
                      }`}>
                        {sel && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Skills preview */}
          {fetchedSkills.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-sm font-semibold text-amber-800 flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4" />
                Skills extracted from all repositories
              </p>
              <div className="flex flex-wrap gap-1.5">
                {fetchedSkills.map((s) => (
                  <span key={s} className="text-xs bg-white border border-amber-200 text-amber-800 px-2 py-0.5 rounded-full">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Apply button */}
          <button
            onClick={handleApply}
            disabled={selectedIds.size === 0}
            className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              applied
                ? 'bg-green-100 text-green-700 border border-green-200'
                : selectedIds.size === 0
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {applied ? (
              <><Check className="w-4 h-4" />Applied to profile</>
            ) : (
              <><Zap className="w-4 h-4" />Apply {selectedIds.size} repo{selectedIds.size !== 1 ? 's' : ''} &amp; extracted skills to profile</>
            )}
          </button>

          {applied && (
            <p className="text-xs text-center text-slate-500">
              Selected projects added to your Projects section. Go to Skills to promote extracted skills.
            </p>
          )}
        </>
      )}
    </div>
  );
}
