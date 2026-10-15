import React, { useCallback, useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, RotateCcw, Search } from 'lucide-react';
import { taxonomyService } from '../../../services/taxonomyService.js';
import { ErrorBox, Loading, Pagination, btn, card, input } from './components.jsx';
import { SOURCE_LABELS, taxonomyError } from './taxonomyRules.js';

// Professions: search, and admin overrides of title / description / category / active.
// On an imported profession an override survives re-imports until it is reset to the dataset value.

const OVERRIDE_FLAGS = { title: 'title_set_by_admin', description: 'description_set_by_admin', category: 'category_set_by_admin' };

export function overriddenFields(profession) {
  const fields = Object.keys(OVERRIDE_FLAGS).filter((f) => profession?.[OVERRIDE_FLAGS[f]]);
  if (profession?.disabled_by_admin) fields.push('active');
  return fields;
}

function OverrideTag({ field, profession, onReset, disabled }) {
  if (profession.source === 'manual' || !overriddenFields(profession).includes(field)) return null;
  const original = profession.dataset_values?.[field];
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-800 bg-amber-100 rounded px-1.5 py-0.5 ml-2">
      Admin override
      <button type="button" className="underline disabled:opacity-50" disabled={disabled} onClick={() => onReset([field])} title={original != null ? `Dataset value: ${original}` : undefined}>
        reset to dataset value
      </button>
    </span>
  );
}

// A label for one control, with the override tag beside it (not inside the <label>: a button
// inside a label would take the label away from the field).
function Field({ id, label, field, profession, onReset, disabled, children }) {
  return (
    <div className="text-sm text-slate-600">
      <div className="flex items-center">
        <label htmlFor={id}>{label}</label>
        <OverrideTag field={field} profession={profession} onReset={onReset} disabled={disabled} />
      </div>
      {children}
    </div>
  );
}

function EditPanel({ profession, categories, lock, onSaved, onClose }) {
  const id = useId();
  const [form, setForm] = useState({
    title: profession.title || '',
    description: profession.description || '',
    category: profession.category || '',
    active: Boolean(profession.active),
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const disabled = Boolean(lock) || saving;

  const changes = {};
  if (form.title.trim() !== (profession.title || '')) changes.title = form.title.trim();
  if (form.description.trim() !== (profession.description || '')) changes.description = form.description.trim();
  if (form.category !== (profession.category || '')) changes.category = form.category;
  if (form.active !== Boolean(profession.active)) changes.active = form.active;

  const run = async (fn, message) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fn();
      toast.success(message);
      onSaved(res.data.result);
    } catch (err) {
      setError(taxonomyError(err));
    } finally {
      setSaving(false);
    }
  };

  const reset = (fields) => run(() => taxonomyService.resetProfession(profession.profession_id, fields), 'Reset to the dataset value');

  return (
    <div className={`${card} p-5 space-y-3`} data-testid="profession-edit">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-800">{profession.title}</p>
          <p className="text-xs text-slate-500">
            {SOURCE_LABELS[profession.source]} {profession.source_code || ''} · {profession.profession_id}
          </p>
        </div>
        <button type="button" className={btn.secondary} onClick={onClose}>
          Close
        </button>
      </div>
      <ErrorBox error={error} onDismiss={() => setError(null)} />
      <Field id={`${id}-title`} label="Title" field="title" profession={profession} onReset={reset} disabled={disabled}>
        <input id={`${id}-title`} className={`${input} mt-1`} value={form.title} maxLength={200} disabled={disabled} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field id={`${id}-description`} label="Description" field="description" profession={profession} onReset={reset} disabled={disabled}>
        <textarea id={`${id}-description`} className={`${input} mt-1`} rows={4} value={form.description} maxLength={5000} disabled={disabled} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field id={`${id}-category`} label="Category" field="category" profession={profession} onReset={reset} disabled={disabled}>
        <select id={`${id}-category`} className={`${input} mt-1`} value={form.category} disabled={disabled} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {!categories.includes(form.category) && <option value={form.category}>{form.category || '—'}</option>}
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <input id={`${id}-active`} type="checkbox" checked={form.active} disabled={disabled} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
        <label htmlFor={`${id}-active`}>Active (used in career matching)</label>
        <OverrideTag field="active" profession={profession} onReset={reset} disabled={disabled} />
      </div>
      {profession.source !== 'manual' && (
        <p className="text-xs text-slate-500">
          Changes to an imported profession are kept as admin overrides when the dataset is imported again. Each save takes a snapshot first (see History).
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className={btn.primary}
          disabled={disabled || Object.keys(changes).length === 0}
          onClick={() => run(() => taxonomyService.editProfession(profession.profession_id, changes), 'Profession saved')}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {profession.source !== 'manual' && overriddenFields(profession).length > 0 && (
          <button type="button" className={btn.secondary} disabled={disabled} onClick={() => reset(null)}>
            <RotateCcw className="w-4 h-4" /> Reset all overrides
          </button>
        )}
      </div>
    </div>
  );
}

export default function ProfessionsTab({ lock }) {
  const [filters, setFilters] = useState({ search: '', source: '', active: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    const params = { page, limit: 20 };
    if (filters.search.trim()) params.search = filters.search.trim();
    if (filters.source) params.source = filters.source;
    if (filters.active) params.active = filters.active;
    try {
      setResult(await taxonomyService.listProfessions(params));
      setError(null);
    } catch (err) {
      setError(taxonomyError(err));
      setResult({ data: [], categories: [] });
    }
  }, [filters, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const setFilter = (key, value) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  return (
    <div className="grid xl:grid-cols-2 gap-5">
      <div className="space-y-3">
        <div className={`${card} p-4 grid grid-cols-3 gap-3`}>
          <label className="col-span-3 md:col-span-1 text-sm text-slate-600">
            <span className="flex items-center gap-1">
              <Search className="w-3.5 h-3.5" /> Search
            </span>
            <input className={`${input} mt-1`} aria-label="Search professions" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
          </label>
          <label className="text-sm text-slate-600">
            Source
            <select className={`${input} mt-1`} value={filters.source} onChange={(e) => setFilter('source', e.target.value)}>
              <option value="">All</option>
              <option value="onet">O*NET</option>
              <option value="esco">ESCO</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            Status
            <select className={`${input} mt-1`} value={filters.active} onChange={(e) => setFilter('active', e.target.value)}>
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
        </div>
        <ErrorBox error={error} />
        <div className={`${card} overflow-hidden`}>
          {result === null ? (
            <Loading />
          ) : result.data.length === 0 ? (
            <p className="text-center py-10 text-slate-400 text-sm">No professions match these filters.</p>
          ) : (
            <ul>
              {result.data.map((p) => (
                <li key={p.profession_id} className="px-4 py-2.5 border-b border-slate-100 text-sm flex items-center justify-between gap-2" data-testid="profession-row">
                  <span className="min-w-0">
                    <span className={p.active ? 'text-slate-800' : 'text-slate-400 line-through'}>{p.title}</span>
                    <span className="block text-xs text-slate-500">
                      {SOURCE_LABELS[p.source]} · {p.category || 'Other'} · {(p.skills || []).length} skills
                      {overriddenFields(p).length > 0 && <span className="text-amber-700"> · override: {overriddenFields(p).join(', ')}</span>}
                    </span>
                  </span>
                  <button type="button" className={btn.secondary} aria-label={`Edit ${p.title}`} onClick={() => setSelected(p)}>
                    <Pencil className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Pagination pagination={result?.pagination} onPage={setPage} />
        </div>
      </div>
      <div>
        {selected ? (
          <EditPanel
            key={`${selected.profession_id}:${selected.updated_at}`}
            profession={selected}
            categories={result?.categories || []}
            lock={lock}
            onClose={() => setSelected(null)}
            onSaved={(updated) => {
              setSelected(updated);
              load();
            }}
          />
        ) : (
          <p className="text-sm text-slate-500">Select a profession to edit it.</p>
        )}
      </div>
    </div>
  );
}
