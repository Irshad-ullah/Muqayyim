import React, { useState, useEffect } from 'react';
import { Github, Star, RefreshCw, CheckCircle2, Circle, ExternalLink, Check } from 'lucide-react';
import { profileService } from '../../../services/profileService.js';
import toast from 'react-hot-toast';

export default function Step3GitHub({ profile, onChange }) {
  const [username, setUsername]   = useState(profile.githubData?.username || '');
  const [repos, setRepos]         = useState(profile.githubData?.repos     || []);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [applied, setApplied]     = useState(false);

  // selectedIds tracks which repoIds the user has checked
  const [selectedIds, setSelectedIds] = useState(
    new Set((profile.projects?.github || []).map(r => r.repoId))
  );

  // Sync username when profile loads
  useEffect(() => {
    if (profile.githubData?.username) setUsername(profile.githubData.username);
    if (profile.githubData?.repos?.length) setRepos(profile.githubData.repos);
  }, [profile.githubData]);

  const handleFetch = async () => {
    if (!username.trim()) return;
    setLoading(true);
    setError('');
    setApplied(false);
    try {
      const result = await profileService.fetchGitHub(username.trim());
      setRepos(result.repos);
      setSelectedIds(new Set());
      onChange({
        githubData: {
          ...profile.githubData,
          username:        username.trim(),
          repos:           result.repos,
          extractedSkills: result.extractedSkills,
          lastSynced:      new Date().toISOString(),
        },
      });
      toast.success(`Fetched ${result.repos.length} repositories`);
    } catch (err) {
      setError(err.message || 'Failed to fetch repositories');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (repoId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(repoId) ? next.delete(repoId) : next.add(repoId);
      return next;
    });
    setApplied(false);
  };

  const handleApply = () => {
    const selected = repos.filter(r => selectedIds.has(r.repoId));

    const githubProjects = selected.map(r => ({
      repoId:      r.repoId,
      name:        r.name,
      description: r.description || '',
      url:         r.url,
      languages:   r.language ? [r.language] : [],
      topics:      r.topics || [],
      stars:       r.stars || 0,
    }));

    // Skills: languages + topics from selected repos only
    const skillSet = new Set();
    selected.forEach(r => {
      if (r.language) skillSet.add(r.language);
      r.topics?.forEach(t => skillSet.add(t));
    });
    const githubSkills = Array.from(skillSet).sort();

    onChange({
      projects:   { ...profile.projects,  github: githubProjects },
      skills:     { ...profile.skills,    extracted: githubSkills },
    });
    setApplied(true);
    toast.success(`${selected.length} repo${selected.length !== 1 ? 's' : ''} applied to profile`);
  };

  return (
    <div className="space-y-6">

      {/* Username input */}
      <div>
        <label className="label">GitHub Username</label>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Github className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={username}
              onChange={e => { setUsername(e.target.value); setApplied(false); }}
              onKeyDown={e => e.key === 'Enter' && handleFetch()}
              placeholder="e.g. octocat"
              className="input-field pl-9"
            />
          </div>
          <button
            onClick={handleFetch}
            disabled={loading || !username.trim()}
            className="btn-primary w-auto px-5 py-2.5 text-sm"
          >
            {loading
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <Github className="w-4 h-4" />}
            {loading ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
        {profile.githubData?.lastSynced && (
          <p className="text-xs text-slate-400 mt-1">
            Last synced: {new Date(profile.githubData.lastSynced).toLocaleString()}
          </p>
        )}
      </div>

      {repos.length === 0 && !loading && (
        <p className="text-sm text-slate-400 text-center py-6 italic">
          Enter your GitHub username and click Fetch to load repositories.
        </p>
      )}

      {repos.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              {repos.length} repositories — {selectedIds.size} selected
            </p>
            <button
              onClick={() => {
                if (selectedIds.size === repos.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(repos.map(r => r.repoId)));
                }
                setApplied(false);
              }}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
            >
              {selectedIds.size === repos.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
            {repos.map(repo => {
              const sel = selectedIds.has(repo.repoId);
              return (
                <button
                  key={repo.repoId}
                  onClick={() => toggle(repo.repoId)}
                  className={`text-left p-4 rounded-xl border transition-all ${
                    sel
                      ? 'border-indigo-300 bg-indigo-50'
                      : 'border-slate-100 bg-white hover:border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-sm font-semibold text-slate-800 truncate">{repo.name}</span>
                    {sel
                      ? <CheckCircle2 className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                      : <Circle       className="w-4 h-4 text-slate-200 flex-shrink-0" />}
                  </div>
                  {repo.description && (
                    <p className="text-xs text-slate-500 line-clamp-2 mb-2">{repo.description}</p>
                  )}
                  <div className="flex items-center gap-3 flex-wrap">
                    {repo.language && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                        {repo.language}
                      </span>
                    )}
                    {repo.stars > 0 && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <Star className="w-3 h-3" /> {repo.stars}
                      </span>
                    )}
                    {repo.url && (
                      <a
                        href={repo.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-indigo-500 hover:underline flex items-center gap-0.5 ml-auto"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <button
            onClick={handleApply}
            disabled={selectedIds.size === 0}
            className={`btn-primary ${applied ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
          >
            {applied
              ? <><Check className="w-4 h-4" /> Applied to Profile</>
              : <><Github className="w-4 h-4" /> Apply {selectedIds.size} Repo{selectedIds.size !== 1 ? 's' : ''} to Profile</>}
          </button>
        </>
      )}
    </div>
  );
}
