import React, { useState } from 'react';
import { Plus, Edit2, Trash2, X } from 'lucide-react';

const EMPTY = { name: '', description: '', url: '', technologies: [] };

export default function ProjectsForm({ data = [], onChange }) {
  const [editIndex, setEditIndex] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [techInput, setTechInput] = useState('');

  const startEdit = (index) => {
    setEditIndex(index);
    setForm(index === -1 ? { ...EMPTY, technologies: [] } : { ...data[index], technologies: [...(data[index].technologies || [])] });
    setTechInput('');
  };
  const cancelEdit = () => { setEditIndex(null); setForm(EMPTY); setTechInput(''); };

  const saveEntry = () => {
    if (!form.name.trim()) return;
    const next = [...data];
    editIndex === -1 ? next.push({ ...form }) : (next[editIndex] = { ...form });
    onChange(next);
    cancelEdit();
  };

  const removeEntry = (index) => {
    onChange(data.filter((_, i) => i !== index));
    if (editIndex === index) cancelEdit();
  };

  const addTech = () => {
    const t = techInput.trim();
    if (!t || form.technologies.includes(t)) { setTechInput(''); return; }
    setForm((p) => ({ ...p, technologies: [...p.technologies, t] }));
    setTechInput('');
  };
  const removeTech = (t) => setForm((p) => ({ ...p, technologies: p.technologies.filter((x) => x !== t) }));
  const f = (field, value) => setForm((p) => ({ ...p, [field]: value }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">Projects</h2>
        <p className="text-sm text-slate-500">Showcase your personal and professional work. GitHub projects are managed in the GitHub tab.</p>
      </div>

      <div className="space-y-3">
        {data.map((proj, index) => (
          <div key={index} className="card p-4">
            {editIndex === index ? (
              <ProjForm form={form} f={f} techInput={techInput} setTechInput={setTechInput} addTech={addTech} removeTech={removeTech} onSave={saveEntry} onCancel={cancelEdit} />
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900">{proj.name}</p>
                  {proj.description && <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{proj.description}</p>}
                  {proj.technologies?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {proj.technologies.map((t) => <span key={t} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{t}</span>)}
                    </div>
                  )}
                  {proj.url && <a href={proj.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline mt-1 block">View Project ↗</a>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(index)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => removeEntry(index)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {editIndex === -1 ? (
        <div className="card p-4">
          <ProjForm form={form} f={f} techInput={techInput} setTechInput={setTechInput} addTech={addTech} removeTech={removeTech} onSave={saveEntry} onCancel={cancelEdit} />
        </div>
      ) : (
        <button onClick={() => startEdit(-1)} className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
          <Plus className="w-4 h-4" />Add Project
        </button>
      )}
    </div>
  );
}

function ProjForm({ form, f, techInput, setTechInput, addTech, removeTech, onSave, onCancel }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Project Name *</label>
        <input value={form.name} onChange={(e) => f('name', e.target.value)} placeholder="My Awesome Project" className="input-field text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
        <textarea value={form.description} onChange={(e) => f('description', e.target.value)} placeholder="What does this project do?" className="input-field text-sm h-20 resize-none" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Project URL</label>
        <input value={form.url} onChange={(e) => f('url', e.target.value)} placeholder="https://github.com/…" className="input-field text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Technologies</label>
        <div className="flex gap-2 mb-2">
          <input value={techInput} onChange={(e) => setTechInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTech(); } }} placeholder="Add technology" className="input-field text-sm flex-1" />
          <button onClick={addTech} disabled={!techInput.trim()} className="btn-secondary px-3"><Plus className="w-4 h-4" /></button>
        </div>
        {form.technologies.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {form.technologies.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5 rounded">
                {t}
                <button onClick={() => removeTech(t)} className="hover:text-indigo-900"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} disabled={!form.name.trim()} className="btn-primary text-sm py-1.5 px-4">Save</button>
        <button onClick={onCancel} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
      </div>
    </div>
  );
}
