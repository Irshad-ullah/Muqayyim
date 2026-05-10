import React, { useState } from 'react';
import { Plus, X, Edit2, Github, FileText, Code2, ExternalLink } from 'lucide-react';

const TAG_COLORS = [
  'bg-blue-100 text-blue-700 border-blue-200',
  'bg-green-100 text-green-700 border-green-200',
  'bg-purple-100 text-purple-700 border-purple-200',
  'bg-orange-100 text-orange-700 border-orange-200',
  'bg-pink-100 text-pink-700 border-pink-200',
  'bg-teal-100 text-teal-700 border-teal-200',
];

const SOURCE_BADGE = {
  cv:     { style: 'bg-blue-100 text-blue-700',     Icon: FileText, label: 'From CV' },
  github: { style: 'bg-purple-100 text-purple-700', Icon: Github,   label: 'GitHub'  },
  manual: { style: 'bg-slate-100 text-slate-600',   Icon: Code2,    label: 'Manual'  },
};

const parseTechs = (str) => str.split(',').map(t => t.trim()).filter(Boolean);
const getTechs   = (p)   => p.technologies || p.languages || p.topics || [];

const EMPTY_NEW = { name: '', description: '', url: '', techStr: '' };

export default function Step5Projects({ profile, onChange }) {
  const [editingKey, setEditingKey] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [editTechStr, setEditTechStr] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newForm, setNewForm] = useState(EMPTY_NEW);

  const manualProjects = profile.projects?.manual || [];
  const githubProjects = profile.projects?.github || [];
  const cvProjects     = profile.projects?.cv     || [];

  const startEdit = (key, p) => {
    setEditingKey(key);
    setEditValues({ name: p.name || '', description: p.description || '', url: p.url || '' });
    setEditTechStr(getTechs(p).join(', '));
  };

  const cancelEdit = () => { setEditingKey(null); setEditValues({}); setEditTechStr(''); };

  const saveEdit = () => {
    if (!editValues.name?.trim()) return;
    const colon   = editingKey.indexOf(':');
    const source  = editingKey.slice(0, colon);
    const id      = editingKey.slice(colon + 1);
    const updated = { ...editValues, name: editValues.name.trim(), technologies: parseTechs(editTechStr) };

    if (source === 'cv') {
      const i = parseInt(id);
      onChange({ projects: { ...profile.projects, cv: cvProjects.map((p, idx) => idx === i ? { ...p, ...updated } : p) } });
    } else if (source === 'github') {
      onChange({ projects: { ...profile.projects, github: githubProjects.map(r => r.repoId === id ? { ...r, ...updated } : r) } });
    } else {
      const i = parseInt(id);
      onChange({ projects: { ...profile.projects, manual: manualProjects.map((p, idx) => idx === i ? { ...p, ...updated } : p) } });
    }
    cancelEdit();
  };

  const removeProject = (source, keyId) => {
    if (source === 'cv') {
      onChange({ projects: { ...profile.projects, cv: cvProjects.filter((_, i) => i !== keyId) } });
    } else if (source === 'github') {
      onChange({ projects: { ...profile.projects, github: githubProjects.filter(r => r.repoId !== keyId) } });
    } else {
      onChange({ projects: { ...profile.projects, manual: manualProjects.filter((_, i) => i !== keyId) } });
    }
  };

  const addProject = () => {
    if (!newForm.name.trim()) return;
    const p = { name: newForm.name.trim(), description: newForm.description, url: newForm.url, technologies: parseTechs(newForm.techStr) };
    onChange({ projects: { ...profile.projects, manual: [...manualProjects, p] } });
    setNewForm(EMPTY_NEW);
    setIsAdding(false);
  };

  const renderCard = (p, source, key, onRemove) => {
    const isEditing = editingKey === key;
    const badge     = SOURCE_BADGE[source];
    const techs     = getTechs(p);

    return (
      <div key={key} className="border border-slate-200 rounded-xl bg-white p-4">
        {isEditing ? (
          <div className="space-y-3">
            <input
              autoFocus
              value={editValues.name}
              onChange={e => setEditValues(v => ({ ...v, name: e.target.value }))}
              placeholder="Project Name *"
              className="input-field"
            />
            <textarea
              rows={3}
              value={editValues.description}
              onChange={e => setEditValues(v => ({ ...v, description: e.target.value }))}
              placeholder="Description"
              className="input-field resize-none"
            />
            <input
              value={editValues.url}
              onChange={e => setEditValues(v => ({ ...v, url: e.target.value }))}
              placeholder="URL (optional)"
              className="input-field"
            />
            <input
              value={editTechStr}
              onChange={e => setEditTechStr(e.target.value)}
              placeholder="Technologies (comma-separated, e.g. React, Node.js)"
              className="input-field"
            />
            {editTechStr && (
              <div className="flex flex-wrap gap-1">
                {parseTechs(editTechStr).map((t, i) => (
                  <span key={i} className={`text-xs font-medium px-2 py-0.5 rounded-full border ${TAG_COLORS[i % TAG_COLORS.length]}`}>{t}</span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={!editValues.name?.trim()}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium disabled:opacity-50">
                Save
              </button>
              <button onClick={cancelEdit}
                className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${badge.style}`}>
                  <badge.Icon className="w-3 h-3" /> {badge.label}
                </span>
              </div>
              {p.description && <p className="text-xs text-slate-500 line-clamp-2 mb-2">{p.description}</p>}
              {techs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {techs.map((t, i) => (
                    <span key={i} className={`text-xs font-medium px-2 py-0.5 rounded-full border ${TAG_COLORS[i % TAG_COLORS.length]}`}>{t}</span>
                  ))}
                </div>
              )}
              {p.url && (
                <a href={p.url} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-1">
                  <ExternalLink className="w-3 h-3" /> View
                </a>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => startEdit(key, p)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600 transition-colors">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={onRemove}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-red-500 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const total = manualProjects.length + githubProjects.length + cvProjects.length;

  return (
    <div className="space-y-6">

      {cvProjects.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-500" /> Projects from CV
          </h3>
          <div className="space-y-2">
            {cvProjects.map((p, i) => renderCard(p, 'cv', `cv:${i}`, () => removeProject('cv', i)))}
          </div>
        </section>
      )}

      {githubProjects.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Github className="w-4 h-4 text-purple-500" /> GitHub Repositories
          </h3>
          <div className="space-y-2">
            {githubProjects.map(r => renderCard(r, 'github', `github:${r.repoId}`, () => removeProject('github', r.repoId)))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Code2 className="w-4 h-4 text-slate-500" /> Manual Projects
          </h3>
          {!isAdding && (
            <button onClick={() => setIsAdding(true)}
              className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
              <Plus className="w-4 h-4" /> Add Project
            </button>
          )}
        </div>

        {manualProjects.length === 0 && !isAdding && (
          <p className="text-sm text-slate-400 italic">No manual projects added yet.</p>
        )}

        <div className="space-y-2 mb-3">
          {manualProjects.map((p, i) => renderCard(p, 'manual', `manual:${i}`, () => removeProject('manual', i)))}
        </div>

        {isAdding && (
          <div className="border border-indigo-100 bg-indigo-50/40 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-800">New Project</p>
            <input autoFocus value={newForm.name}
              onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Project Name *" className="input-field" />
            <textarea rows={3} value={newForm.description}
              onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description" className="input-field resize-none" />
            <input value={newForm.url}
              onChange={e => setNewForm(f => ({ ...f, url: e.target.value }))}
              placeholder="URL (optional)" className="input-field" />
            <input value={newForm.techStr}
              onChange={e => setNewForm(f => ({ ...f, techStr: e.target.value }))}
              placeholder="Technologies (comma-separated)" className="input-field" />
            {newForm.techStr && (
              <div className="flex flex-wrap gap-1">
                {parseTechs(newForm.techStr).map((t, i) => (
                  <span key={i} className={`text-xs font-medium px-2 py-0.5 rounded-full border ${TAG_COLORS[i % TAG_COLORS.length]}`}>{t}</span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={addProject} disabled={!newForm.name.trim()}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium disabled:opacity-50">
                Add Project
              </button>
              <button onClick={() => { setIsAdding(false); setNewForm(EMPTY_NEW); }}
                className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {total === 0 && !isAdding && (
        <p className="text-sm text-slate-400 text-center italic py-4">
          No projects yet. Complete Steps 2 &amp; 3 or add a manual project above.
        </p>
      )}

    </div>
  );
}
