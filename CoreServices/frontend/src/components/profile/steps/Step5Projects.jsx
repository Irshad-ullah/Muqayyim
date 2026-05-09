import React, { useState } from 'react';
import { Plus, X, Edit2, Check, Github, FileText, Code2, ExternalLink } from 'lucide-react';

const TAG_STYLES = {
  cv:     'bg-blue-100 text-blue-700',
  github: 'bg-purple-100 text-purple-700',
  manual: 'bg-slate-100 text-slate-600',
};

const SOURCE_ICONS = {
  cv:     <FileText className="w-3 h-3" />,
  github: <Github   className="w-3 h-3" />,
  manual: <Code2    className="w-3 h-3" />,
};

const SOURCE_LABELS = { cv: 'From CV', github: 'GitHub', manual: 'Manual' };

const EMPTY_MANUAL = { name: '', description: '', url: '', technologies: [], _tech: '' };

function ProjectCard({ project, source, onRemove, onEdit }) {
  return (
    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50 flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <p className="text-sm font-semibold text-slate-800">{project.name}</p>
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${TAG_STYLES[source]}`}>
            {SOURCE_ICONS[source]} {SOURCE_LABELS[source]}
          </span>
        </div>
        {project.description && (
          <p className="text-xs text-slate-500 line-clamp-2 mb-2">{project.description}</p>
        )}
        <div className="flex flex-wrap gap-1">
          {(project.technologies || project.languages || project.topics || []).map((t, i) => (
            <span key={i} className="text-xs bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded">{t}</span>
          ))}
        </div>
        {project.url && (
          <a href={project.url} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-1">
            <ExternalLink className="w-3 h-3" /> View
          </a>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {onEdit && (
          <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-white text-slate-400 hover:text-indigo-600 transition-colors">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={onRemove} className="p-1.5 rounded-lg hover:bg-white text-slate-400 hover:text-red-500 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function Step5Projects({ profile, onChange }) {
  const [form, setForm]       = useState(EMPTY_MANUAL);
  const [editIdx, setEditIdx] = useState(null);   // null = not editing, number = editing that index
  const [adding, setAdding]   = useState(false);

  const manualProjects = profile.projects?.manual || [];
  const githubProjects = profile.projects?.github || [];
  const cvProjects     = profile.projects?.cv     || [];

  const addTech = () => {
    if (!form._tech.trim()) return;
    setForm(f => ({ ...f, technologies: [...f.technologies, f._tech.trim()], _tech: '' }));
  };

  const saveManual = () => {
    if (!form.name.trim()) return;
    const { _tech, ...rest } = form;
    const updated = editIdx !== null
      ? manualProjects.map((p, i) => (i === editIdx ? rest : p))
      : [...manualProjects, rest];
    onChange({ projects: { ...profile.projects, manual: updated } });
    setForm(EMPTY_MANUAL);
    setAdding(false);
    setEditIdx(null);
  };

  const removeManual = (i) =>
    onChange({ projects: { ...profile.projects, manual: manualProjects.filter((_, idx) => idx !== i) } });

  const removeGitHub = (repoId) =>
    onChange({ projects: { ...profile.projects, github: githubProjects.filter(r => r.repoId !== repoId) } });

  const removeCv = (i) =>
    onChange({ projects: { ...profile.projects, cv: cvProjects.filter((_, idx) => idx !== i) } });

  const startEdit = (i) => {
    const p = manualProjects[i];
    setForm({ ...p, _tech: '' });
    setEditIdx(i);
    setAdding(true);
  };

  const total = manualProjects.length + githubProjects.length + cvProjects.length;

  return (
    <div className="space-y-6">

      {/* CV Projects */}
      {cvProjects.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-500" /> Projects from CV
          </h3>
          <div className="space-y-2">
            {cvProjects.map((p, i) => (
              <ProjectCard key={i} project={p} source="cv" onRemove={() => removeCv(i)} />
            ))}
          </div>
        </section>
      )}

      {/* GitHub Projects */}
      {githubProjects.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Github className="w-4 h-4 text-purple-500" /> GitHub Repositories
          </h3>
          <div className="space-y-2">
            {githubProjects.map((r) => (
              <ProjectCard key={r.repoId} project={r} source="github"
                onRemove={() => removeGitHub(r.repoId)} />
            ))}
          </div>
        </section>
      )}

      {/* Manual Projects */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Code2 className="w-4 h-4 text-slate-500" /> Manual Projects
          </h3>
          {!adding && (
            <button
              onClick={() => { setForm(EMPTY_MANUAL); setEditIdx(null); setAdding(true); }}
              className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              <Plus className="w-4 h-4" /> Add Project
            </button>
          )}
        </div>

        {manualProjects.length === 0 && !adding && (
          <p className="text-sm text-slate-400 italic">No manual projects added yet.</p>
        )}

        <div className="space-y-2 mb-4">
          {manualProjects.map((p, i) => (
            <ProjectCard key={i} project={p} source="manual"
              onRemove={() => removeManual(i)}
              onEdit={() => startEdit(i)} />
          ))}
        </div>

        {adding && (
          <div className="p-4 bg-indigo-50/40 border border-indigo-100 rounded-xl space-y-3">
            <h4 className="text-sm font-semibold text-slate-800">
              {editIdx !== null ? 'Edit Project' : 'New Project'}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="label">Project Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. E-commerce Platform" className="input-field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Description</label>
                <textarea rows={3} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of the project…" className="input-field resize-none" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">URL</label>
                <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://github.com/…" className="input-field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Technologies</label>
                <div className="flex gap-2 mb-2">
                  <input value={form._tech}
                    onChange={e => setForm(f => ({ ...f, _tech: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTech(); }}}
                    placeholder="Add technology…" className="input-field flex-1" />
                  <button onClick={addTech} className="btn-secondary w-auto px-3 text-sm">Add</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {form.technologies.map((t, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-white border border-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-full">
                      {t}
                      <button onClick={() => setForm(f => ({ ...f, technologies: f.technologies.filter((_, idx) => idx !== i) }))}>
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setAdding(false); setEditIdx(null); setForm(EMPTY_MANUAL); }}
                className="btn-secondary w-auto px-4 py-2 text-sm">Cancel</button>
              <button onClick={saveManual} disabled={!form.name.trim()}
                className="btn-primary w-auto px-4 py-2 text-sm">
                <Check className="w-4 h-4" />
                {editIdx !== null ? 'Save Changes' : 'Add Project'}
              </button>
            </div>
          </div>
        )}
      </section>

      {total === 0 && (
        <p className="text-sm text-slate-400 text-center italic py-4">
          No projects yet. Complete Steps 2 &amp; 3 or add a manual project above.
        </p>
      )}

    </div>
  );
}
