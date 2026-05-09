import React, { useState, useMemo } from 'react';
import { X, Plus, Zap, RefreshCw } from 'lucide-react';
import { profileService } from '../../../services/profileService.js';
import toast from 'react-hot-toast';

const SOURCE_STYLES = {
  cv:       { label: 'CV',     cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  github:   { label: 'GitHub', cls: 'bg-purple-100 text-purple-700 border-purple-200' },
  manual:   { label: 'Manual', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export default function Step4Skills({ profile, onChange }) {
  const [input, setInput]       = useState('');
  const [merging, setMerging]   = useState(false);

  // Build merged display list (deduplicated, source tagged)
  const mergedSkills = useMemo(() => {
    const seen   = new Set();
    const result = [];
    const add = (arr, source) => {
      (arr || []).forEach(s => {
        const key = s.toLowerCase().trim();
        if (s && !seen.has(key)) { seen.add(key); result.push({ name: s, source }); }
      });
    };
    add(profile.skills?.cv,        'cv');
    add(profile.skills?.extracted, 'github');
    add(profile.skills?.manual,    'manual');
    return result;
  }, [profile.skills]);

  const addManual = (raw) => {
    const name = raw.trim();
    if (!name) return;
    if (mergedSkills.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      toast.error('Skill already in list');
      return;
    }
    onChange({ skills: { ...profile.skills, manual: [...(profile.skills?.manual || []), name] } });
    setInput('');
  };

  const removeSkill = ({ name, source }) => {
    const arr = (profile.skills?.[source] || []).filter(s => s.toLowerCase() !== name.toLowerCase());
    onChange({ skills: { ...profile.skills, [source]: arr } });
  };

  const handleMerge = async () => {
    setMerging(true);
    try {
      const res = await profileService.extractSkills(
        profile.skills?.cv        || [],
        profile.skills?.extracted || [],
        profile.skills?.manual    || [],
      );
      // Put all merged back into manual, clear cv/extracted to avoid duplication
      onChange({ skills: { manual: res.skills, cv: [], extracted: [] } });
      toast.success(`${res.skills.length} skills merged and deduplicated`);
    } catch {
      toast.error('Merge failed');
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="space-y-6">

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-semibold text-slate-800">All Skills</h3>
          <button
            onClick={handleMerge}
            disabled={merging || mergedSkills.length === 0}
            className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-50"
          >
            {merging
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <Zap className="w-4 h-4" />}
            Merge &amp; Deduplicate
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Skills are automatically gathered from your CV and GitHub. Add any that are missing below.
          Hit "Merge &amp; Deduplicate" to remove near-duplicates server-side.
        </p>

        {/* Legend */}
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          {Object.entries(SOURCE_STYLES).map(([key, { label, cls }]) => (
            <span key={key} className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}>
              {label}
            </span>
          ))}
        </div>

        {mergedSkills.length === 0 && (
          <p className="text-sm text-slate-400 italic text-center py-6">
            No skills yet. Complete Steps 2 &amp; 3 or add skills manually below.
          </p>
        )}

        {/* Tag cloud */}
        <div className="flex flex-wrap gap-2 mb-4">
          {mergedSkills.map(({ name, source }) => {
            const { cls } = SOURCE_STYLES[source] || SOURCE_STYLES.manual;
            return (
              <span
                key={`${source}-${name}`}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${cls}`}
              >
                {name}
                <button
                  onClick={() => removeSkill({ name, source })}
                  className="hover:opacity-70 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* Add manual skill */}
      <div>
        <label className="label">Add Skill Manually</label>
        <div className="flex gap-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManual(input); } }}
            placeholder="e.g. Kubernetes, Figma, Docker…"
            className="input-field flex-1"
          />
          <button
            onClick={() => addManual(input)}
            disabled={!input.trim()}
            className="btn-primary w-auto px-4 py-2.5 text-sm"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-1">Press Enter or click Add.</p>
      </div>

      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-600">
        <span className="font-semibold">{mergedSkills.length}</span> skills total
        {' · '}
        <span className="text-blue-600">{(profile.skills?.cv || []).length} from CV</span>
        {' · '}
        <span className="text-purple-600">{(profile.skills?.extracted || []).length} from GitHub</span>
        {' · '}
        <span className="text-slate-500">{(profile.skills?.manual || []).length} manual</span>
      </div>

    </div>
  );
}
