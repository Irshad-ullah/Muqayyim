import React, { useState } from 'react';
import { Plus, X, Info } from 'lucide-react';

export default function SkillsForm({ data = { manual: [], extracted: [] }, onChange }) {
  const [input, setInput] = useState('');

  const addSkill = () => {
    const skill = input.trim();
    if (!skill || data.manual.includes(skill)) { setInput(''); return; }
    onChange({ ...data, manual: [...data.manual, skill] });
    setInput('');
  };

  const removeManual = (skill) => onChange({ ...data, manual: data.manual.filter((s) => s !== skill) });

  const promoteExtracted = (skill) => {
    if (data.manual.includes(skill)) return;
    onChange({ ...data, manual: [...data.manual, skill] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">Skills</h2>
        <p className="text-sm text-slate-500">Add your technical and professional skills manually, or import them from GitHub.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Your Skills</label>
        <div className="flex gap-2 mb-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
            placeholder="Type a skill and press Enter"
            className="input-field flex-1 text-sm"
          />
          <button onClick={addSkill} disabled={!input.trim()} className="btn-primary px-4">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="min-h-[52px] flex flex-wrap gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
          {data.manual.length > 0 ? (
            data.manual.map((skill) => (
              <span key={skill} className="inline-flex items-center gap-1.5 bg-indigo-100 text-indigo-800 text-sm px-3 py-1 rounded-full">
                {skill}
                <button onClick={() => removeManual(skill)} className="text-indigo-400 hover:text-indigo-700 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))
          ) : (
            <p className="text-sm text-slate-400 self-center">No skills added yet.</p>
          )}
        </div>
      </div>

      {data.extracted.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-sm font-medium text-slate-700">Extracted from GitHub</label>
            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
              <Info className="w-3 h-3" />
              Click to add to your skills
            </span>
          </div>
          <div className="flex flex-wrap gap-2 p-3 bg-amber-50 rounded-xl border border-amber-200">
            {data.extracted.map((skill) => {
              const added = data.manual.includes(skill);
              return (
                <button
                  key={skill}
                  onClick={() => promoteExtracted(skill)}
                  disabled={added}
                  title={added ? 'Already in your skills' : `Add "${skill}" to your skills`}
                  className={`inline-flex items-center text-sm px-3 py-1 rounded-full transition-all ${
                    added
                      ? 'bg-green-100 text-green-700 cursor-default'
                      : 'bg-white border border-amber-300 text-amber-800 hover:bg-amber-100'
                  }`}
                >
                  {added ? '✓ ' : '+ '}{skill}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
