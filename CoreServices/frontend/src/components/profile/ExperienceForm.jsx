import React, { useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';

const EMPTY = { company: '', title: '', location: '', startDate: '', endDate: '', current: false, description: '' };

export default function ExperienceForm({ data = [], onChange }) {
  const [editIndex, setEditIndex] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const startEdit = (index) => {
    setEditIndex(index);
    setForm(index === -1 ? { ...EMPTY } : { ...data[index] });
  };
  const cancelEdit = () => { setEditIndex(null); setForm(EMPTY); };

  const saveEntry = () => {
    if (!form.company.trim() || !form.title.trim()) return;
    const next = [...data];
    editIndex === -1 ? next.push({ ...form }) : (next[editIndex] = { ...form });
    onChange(next);
    cancelEdit();
  };

  const removeEntry = (index) => {
    onChange(data.filter((_, i) => i !== index));
    if (editIndex === index) cancelEdit();
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">Work Experience</h2>
        <p className="text-sm text-slate-500">Add your work history, most recent first.</p>
      </div>

      <div className="space-y-3">
        {data.map((exp, index) => (
          <div key={index} className="card p-4">
            {editIndex === index ? (
              <EntryForm form={form} setForm={setForm} onSave={saveEntry} onCancel={cancelEdit} />
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-slate-900">{exp.title}</p>
                  <p className="text-sm text-slate-600">{exp.company}{exp.location && ` · ${exp.location}`}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {exp.startDate}{exp.current ? ' – Present' : exp.endDate ? ` – ${exp.endDate}` : ''}
                  </p>
                  {exp.description && <p className="text-sm text-slate-500 mt-1 line-clamp-2">{exp.description}</p>}
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
          <EntryForm form={form} setForm={setForm} onSave={saveEntry} onCancel={cancelEdit} />
        </div>
      ) : (
        <button onClick={() => startEdit(-1)} className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
          <Plus className="w-4 h-4" />Add Experience
        </button>
      )}
    </div>
  );
}

function EntryForm({ form, setForm, onSave, onCancel }) {
  const f = (field, value) => setForm((p) => ({ ...p, [field]: value }));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Job Title *</label>
          <input value={form.title} onChange={(e) => f('title', e.target.value)} placeholder="Software Engineer" className="input-field text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Company *</label>
          <input value={form.company} onChange={(e) => f('company', e.target.value)} placeholder="Acme Corp" className="input-field text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Location</label>
          <input value={form.location} onChange={(e) => f('location', e.target.value)} placeholder="New York, NY" className="input-field text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
          <input value={form.startDate} onChange={(e) => f('startDate', e.target.value)} placeholder="Jan 2022" className="input-field text-sm" />
        </div>
        {!form.current && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
            <input value={form.endDate} onChange={(e) => f('endDate', e.target.value)} placeholder="Dec 2023" className="input-field text-sm" />
          </div>
        )}
        <div className="flex items-center gap-2 pt-5">
          <input id="current-exp" type="checkbox" checked={form.current} onChange={(e) => f('current', e.target.checked)} className="w-4 h-4 text-indigo-600 rounded" />
          <label htmlFor="current-exp" className="text-sm text-slate-600">Currently working here</label>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
        <textarea value={form.description} onChange={(e) => f('description', e.target.value)} placeholder="Describe your responsibilities and achievements…" className="input-field text-sm h-24 resize-none" />
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} disabled={!form.company.trim() || !form.title.trim()} className="btn-primary text-sm py-1.5 px-4">Save</button>
        <button onClick={onCancel} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
      </div>
    </div>
  );
}
