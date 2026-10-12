import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PROFILE_LIMITS as L } from '../../constants/profileLimits.js';
import { PRESENT, parseDate } from '../../validation/profileRules.js';
import { errorFor } from '../../validation/validateProfile.js';
import { FieldError, errorClass, errorProps } from './FieldErrors.jsx';

// Editable experience / education entries for the Profile Builder (FR5.3, FR5.4).
// Every field shows its own error inline; error paths match the server's
// ("experience[1].endDate"), so server errors land under the right input.

const DATE_HINT = 'e.g. 2022-01, Jan 2022 or 2022';

const KINDS = {
  experience: {
    title: 'Work Experience',
    add: 'Add experience',
    max: L.maxEntries.experience,
    empty: () => ({ title: '', company: '', location: '', startDate: '', endDate: '', current: false, description: '', source: 'manual' }),
    heading: (e) => [e.title, e.company].filter(Boolean).join(' · ') || 'New experience',
    fields: [
      { key: 'title', label: 'Job title', required: true, max: L.titleMax },
      { key: 'company', label: 'Company', required: true, max: L.orgMax },
      { key: 'location', label: 'Location', max: L.locationMax },
      { key: 'startDate', label: 'Start date', required: true, date: true },
      { key: 'endDate', label: 'End date', date: true, hiddenWhenCurrent: true },
      { key: 'current', label: 'I currently work here', checkbox: true },
      { key: 'description', label: 'Description', max: L.descriptionMax, multiline: true },
    ],
  },
  education: {
    title: 'Education',
    add: 'Add education',
    max: L.maxEntries.education,
    empty: () => ({ institution: '', degree: '', field: '', startDate: '', endDate: '', gpa: '', source: 'manual' }),
    heading: (e) => [e.degree, e.institution].filter(Boolean).join(' · ') || 'New education',
    fields: [
      { key: 'institution', label: 'Institution', required: true, max: L.orgMax },
      { key: 'degree', label: 'Degree', required: true, max: L.titleMax },
      { key: 'field', label: 'Field of study', max: L.titleMax },
      { key: 'gpa', label: 'GPA', max: L.gpaMax },
      { key: 'startDate', label: 'Start date', date: true },
      { key: 'endDate', label: 'End date (or expected)', date: true },
    ],
  },
};

export default function EntriesEditor({ kind, items = [], errors = [], onChange }) {
  const cfg = KINDS[kind];

  const update = (i, patch) => onChange(items.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, cfg.empty()]);

  // Dates are normalised as soon as the user leaves the field ("Jan 2022" → "2022-01").
  const normaliseDate = (i, key, value) => {
    const r = parseDate(value);
    if (r.error || r.value === value) return;
    if (r.value === PRESENT) {
      if (kind === 'experience' && key === 'endDate') update(i, { endDate: '', current: true });
      return;
    }
    update(i, { [key]: r.value });
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-slate-800">{cfg.title}</h3>
        {items.length < cfg.max && (
          <button type="button" onClick={add} className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
            <Plus className="w-4 h-4" /> {cfg.add}
          </button>
        )}
      </div>
      {items.length === 0 && <p className="text-sm text-slate-400 italic">Nothing added yet.</p>}

      <div className="space-y-3">
        {items.map((entry, i) => (
          <div key={entry._id || i} className="p-4 border border-slate-100 bg-slate-50/60 rounded-xl" data-testid={`${kind}-${i}`}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">{cfg.heading(entry)}</p>
              <button type="button" onClick={() => remove(i)} aria-label={`Remove ${kind} ${i + 1}`} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {cfg.fields.map((f) => {
                if (f.hiddenWhenCurrent && entry.current) return null;
                const path = `${kind}[${i}].${f.key}`;
                const message = errorFor(errors, path);
                const id = `${kind}-${i}-${f.key}`;
                if (f.checkbox) {
                  return (
                    <label key={f.key} className="flex items-center gap-2 text-sm text-slate-600 sm:pt-6">
                      <input
                        type="checkbox"
                        checked={!!entry.current}
                        onChange={(e) => update(i, { current: e.target.checked, ...(e.target.checked ? { endDate: '' } : {}) })}
                        className="w-4 h-4 text-indigo-600 rounded"
                      />
                      {f.label}
                    </label>
                  );
                }
                const Input = f.multiline ? 'textarea' : 'input';
                return (
                  <div key={f.key} className={f.multiline ? 'sm:col-span-2' : ''}>
                    <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
                      {f.label}
                      {f.required ? ' *' : ''}
                    </label>
                    <Input
                      id={id}
                      value={entry[f.key] ?? ''}
                      maxLength={f.max}
                      placeholder={f.date ? DATE_HINT : undefined}
                      rows={f.multiline ? 3 : undefined}
                      onChange={(e) => update(i, { [f.key]: e.target.value })}
                      onBlur={f.date ? (e) => normaliseDate(i, f.key, e.target.value) : undefined}
                      className={`input-field text-sm${f.multiline ? ' resize-none' : ''}${errorClass(message)}`}
                      {...errorProps(id, message)}
                    />
                    <FieldError id={`err-${id}`} message={message} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
