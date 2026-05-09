import React, { useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';

const EMPTY = { institution: '', degree: '', field: '', startDate: '', endDate: '', gpa: '' };

export default function EducationForm({ data = [], onChange }) {
  const [editIndex, setEditIndex] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const startEdit = (index) => {
    setEditIndex(index);
    setForm(index === -1 ? { ...EMPTY } : { ...data[index] });
  };
  const cancelEdit = () => { setEditIndex(null); setForm(EMPTY); };

  const saveEntry = () => {
    if (!form.institution.trim()) return;
    const next = [...data];
    editIndex === -1 ? next.push({ ...form }) : (next[editIndex] = { ...form });
    onChange(next);
    cancelEdit();
  };

  const removeEntry = (index) => {
    onChange(data.filter((_, i) => i !== index));
    if (editIndex === index) cancelEdit();
  };

  const f = (field, value) => setForm((p) => ({ ...p, [field]: value }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">Education</h2>
        <p className="text-sm text-slate-500">Add your academic background, most recent first.</p>
      </div>

      <div className="space-y-3">
        {data.map((edu, index) => (
          <div key={index} className="card p-4">
            {editIndex === index ? (
              <EduForm form={form} f={f} onSave={saveEntry} onCancel={cancelEdit} />
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-slate-900">{edu.degree}{edu.field && ` in ${edu.field}`}</p>
                  <p className="text-sm text-slate-600">{edu.institution}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {edu.startDate}{edu.endDate && ` – ${edu.endDate}`}{edu.gpa && ` · GPA: ${edu.gpa}`}
                  </p>
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
        <div className="card p-4"><EduForm form={form} f={f} onSave={saveEntry} onCancel={cancelEdit} /></div>
      ) : (
        <button onClick={() => startEdit(-1)} className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
          <Plus className="w-4 h-4" />Add Education
        </button>
      )}
    </div>
  );
}

function EduForm({ form, f, onSave, onCancel }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Institution *</label>
          <input value={form.institution} onChange={(e) => f('institution', e.target.value)} placeholder="University of Example" className="input-field text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Degree</label>
          <input value={form.degree} onChange={(e) => f('degree', e.target.value)} placeholder="Bachelor of Science" className="input-field text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Field of Study</label>
          <input value={form.field} onChange={(e) => f('field', e.target.value)} placeholder="Computer Science" className="input-field text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
          <input value={form.startDate} onChange={(e) => f('startDate', e.target.value)} placeholder="Sep 2020" className="input-field text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
          <input value={form.endDate} onChange={(e) => f('endDate', e.target.value)} placeholder="May 2024" className="input-field text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">GPA</label>
          <input value={form.gpa} onChange={(e) => f('gpa', e.target.value)} placeholder="3.8 / 4.0" className="input-field text-sm" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} disabled={!form.institution.trim()} className="btn-primary text-sm py-1.5 px-4">Save</button>
        <button onClick={onCancel} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
      </div>
    </div>
  );
}
