import React from 'react';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { PROFILE_LIMITS as L } from '../../constants/profileLimits.js';
import { errorFor } from '../../validation/validateProfile.js';
import { reviewHint } from '../../validation/cvImport.js';

// CV review (Module 2 FE-4): parsed experience, education and certifications
// as editable cards. Fields the parser flagged in `needsReview` get an amber
// outline and a "Please add …" hint until they are edited; rule errors (the
// same ones the server enforces on verify) show in red under the field.

const DATE_HINT = 'e.g. 2022-01, Jan 2022 or 2022';

const KINDS = {
  experience: {
    title: 'Work Experience',
    empty: () => ({ title: '', company: '', location: '', startDate: '', endDate: '', current: false, description: '', confidence: 1, needsReview: ['startDate', 'endDate'] }),
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
    empty: () => ({ degree: '', institution: '', field: '', startDate: '', endDate: '', gpa: '', confidence: 1, needsReview: [] }),
    fields: [
      { key: 'degree', label: 'Degree', required: true, max: L.titleMax },
      { key: 'institution', label: 'Institution', required: true, max: L.orgMax },
      { key: 'field', label: 'Field of study', max: L.titleMax },
      { key: 'gpa', label: 'GPA', max: L.gpaMax },
      { key: 'startDate', label: 'Start date', date: true },
      { key: 'endDate', label: 'End date (or expected)', date: true },
    ],
  },
  certifications: {
    title: 'Certifications',
    empty: () => ({ name: '', issuer: '', date: '', url: '', confidence: 1, needsReview: [] }),
    fields: [
      { key: 'name', label: 'Certification', required: true, max: L.titleMax },
      { key: 'issuer', label: 'Issuer', required: true, max: L.orgMax },
      { key: 'date', label: 'Date', date: true },
      { key: 'url', label: 'Credential link', max: L.urlMax },
    ],
  },
};

export default function ReviewEntries({ kind, items = [], errors = [], onChange }) {
  const cfg = KINDS[kind];
  const max = L.maxEntries[kind];

  // Editing a field clears its review flag.
  const update = (i, patch) =>
    onChange(
      items.map((e, idx) =>
        idx === i ? { ...e, ...patch, needsReview: (e.needsReview || []).filter((f) => !(f in patch)) } : e,
      ),
    );

  return (
    <div className="border border-gray-200 rounded-lg p-4" data-testid={`review-${kind}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-800">
          {cfg.title} <span className="text-sm font-normal text-gray-500">({items.length})</span>
        </h3>
        {items.length < max && (
          <button type="button" onClick={() => onChange([...items, cfg.empty()])} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            <Plus className="w-4 h-4" /> Add
          </button>
        )}
      </div>
      {!items.length && <p className="text-gray-500 italic text-sm">Nothing extracted. Add one if needed.</p>}

      <div className="space-y-3">
        {items.map((entry, i) => {
          const flagged = entry.needsReview || [];
          return (
            <div
              key={i}
              data-testid={`${kind}-${i}`}
              className={`border rounded-lg p-3 ${flagged.length ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200 bg-white'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  {flagged.length > 0 && <AlertCircle className="w-4 h-4 text-amber-600" aria-label="Needs review" />}
                  {[entry.title || entry.degree || entry.name, entry.company || entry.institution || entry.issuer].filter(Boolean).join(' · ') || 'New entry'}
                </p>
                <button
                  type="button"
                  onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                  aria-label={`Remove ${kind} ${i + 1}`}
                  className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {cfg.fields.map((f) => {
                  if (f.hiddenWhenCurrent && entry.current) return null;
                  const id = `${kind}-${i}-${f.key}`;
                  if (f.checkbox) {
                    return (
                      <label key={f.key} className="flex items-center gap-2 text-sm text-gray-600 sm:pt-6">
                        <input
                          type="checkbox"
                          checked={!!entry.current}
                          onChange={(e) => update(i, { current: e.target.checked, ...(e.target.checked ? { endDate: '' } : {}) })}
                        />
                        {f.label}
                      </label>
                    );
                  }
                  const review = flagged.includes(f.key);
                  const empty = !String(entry[f.key] ?? '').trim();
                  // An empty flagged field shows the friendlier "Please add …" hint.
                  const error = review && empty ? '' : errorFor(errors, `${kind}[${i}].${f.key}`);
                  const message = error || (review ? reviewHint(f.key) : '');
                  const Input = f.multiline ? 'textarea' : 'input';
                  const tone = error ? 'border-red-400' : review ? 'border-amber-400 ring-1 ring-amber-300' : 'border-gray-300';
                  return (
                    <div key={f.key} className={f.multiline ? 'sm:col-span-2' : ''}>
                      <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">
                        {f.label}
                        {f.required ? ' *' : ''}
                      </label>
                      <Input
                        id={id}
                        value={entry[f.key] ?? ''}
                        maxLength={f.max}
                        rows={f.multiline ? 3 : undefined}
                        placeholder={f.date ? DATE_HINT : undefined}
                        onChange={(e) => update(i, { [f.key]: e.target.value })}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={message ? `msg-${id}` : undefined}
                        data-review={review ? 'true' : undefined}
                        className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${tone}`}
                      />
                      {message && (
                        <p id={`msg-${id}`} className={`text-xs mt-1 ${error ? 'text-red-600' : 'text-amber-700'}`}>
                          {message}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
