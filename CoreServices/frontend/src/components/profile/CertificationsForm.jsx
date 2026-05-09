import React, { useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';

const EMPTY = { name: '', issuer: '', date: '', url: '' };

export default function CertificationsForm({ data = [], onChange }) {
  const [editIndex, setEditIndex] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const startEdit = (index) => {
    setEditIndex(index);
    setForm(index === -1 ? { ...EMPTY } : { ...data[index] });
  };
  const cancelEdit = () => { setEditIndex(null); setForm(EMPTY); };

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

  const f = (field, value) => setForm((p) => ({ ...p, [field]: value }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">Certifications</h2>
        <p className="text-sm text-slate-500">Add professional certifications and credentials.</p>
      </div>

      <div className="space-y-3">
        {data.map((cert, index) => (
          <div key={index} className="card p-4">
            {editIndex === index ? (
              <CertForm form={form} f={f} onSave={saveEntry} onCancel={cancelEdit} />
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-slate-900">{cert.name}</p>
                  {cert.issuer && <p className="text-sm text-slate-600">{cert.issuer}</p>}
                  {cert.date && <p className="text-xs text-slate-400 mt-0.5">{cert.date}</p>}
                  {cert.url && (
                    <a href={cert.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline mt-0.5 block" onClick={(e) => e.stopPropagation()}>
                      View Certificate ↗
                    </a>
                  )}
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
        <div className="card p-4"><CertForm form={form} f={f} onSave={saveEntry} onCancel={cancelEdit} /></div>
      ) : (
        <button onClick={() => startEdit(-1)} className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
          <Plus className="w-4 h-4" />Add Certification
        </button>
      )}
    </div>
  );
}

function CertForm({ form, f, onSave, onCancel }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Certification Name *</label>
          <input value={form.name} onChange={(e) => f('name', e.target.value)} placeholder="AWS Certified Solutions Architect" className="input-field text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Issuing Organization</label>
          <input value={form.issuer} onChange={(e) => f('issuer', e.target.value)} placeholder="Amazon Web Services" className="input-field text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
          <input value={form.date} onChange={(e) => f('date', e.target.value)} placeholder="Jan 2024" className="input-field text-sm" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Certificate URL</label>
          <input value={form.url} onChange={(e) => f('url', e.target.value)} placeholder="https://..." className="input-field text-sm" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} disabled={!form.name.trim()} className="btn-primary text-sm py-1.5 px-4">Save</button>
        <button onClick={onCancel} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
      </div>
    </div>
  );
}
