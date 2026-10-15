import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Lock, Plus, Search } from 'lucide-react';
import { taxonomyService } from '../../../services/taxonomyService.js';
import { ErrorBox, Loading, Pagination, btn, card, input } from './components.jsx';
import { taxonomyError } from './taxonomyRules.js';

// Skill taxonomy: curated descriptions, aliases and categories (app/data JSON files in AIServices).
// The benchmark seed descriptions are read-only; a description change re-embeds only that skill.

export const parseAliases = (text) =>
  String(text || '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

function SkillEditor({ skill, categories, lock, onSaved, onClose }) {
  const creating = !skill;
  const [form, setForm] = useState({
    name: skill?.name || '',
    description: skill?.description || '',
    aliases: (skill?.aliases || []).join(', '),
    category: skill?.category || '',
  });
  const [error, setError] = useState(null);
  const [check, setCheck] = useState(null);
  const [saving, setSaving] = useState(false);
  const disabled = Boolean(lock) || saving;
  const seed = Boolean(skill?.seed);

  const payload = () => {
    const out = {};
    if (creating) out.name = form.name.trim();
    if (creating || form.description.trim() !== (skill.description || '')) out.description = form.description.trim();
    const aliases = parseAliases(form.aliases);
    if (creating || aliases.join(',') !== (skill.aliases || []).join(',')) out.aliases = aliases;
    if (form.category && (creating || form.category !== (skill.category || ''))) out.category = form.category;
    return out;
  };
  const changes = payload();
  const nothing = !creating && Object.keys(changes).length === 0;

  const runCheck = async () => {
    setError(null);
    try {
      const res = await taxonomyService.validateSkill({ name: creating ? form.name.trim() : skill.name, ...changes }, creating);
      setCheck(res.data);
    } catch (err) {
      setError(taxonomyError(err));
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = creating ? await taxonomyService.createSkill(changes) : await taxonomyService.updateSkill(skill.name, changes);
      const embedded = res.data.result?.re_embedded || [];
      toast.success(embedded.length ? `Saved — re-embedded ${embedded.join(', ')}` : 'Saved');
      onSaved(res.data.result?.skill);
    } catch (err) {
      setError(taxonomyError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${card} p-5 space-y-3`} data-testid="skill-editor">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-slate-800 flex items-center gap-2">
          {creating ? 'New skill' : skill.name}
          {seed && (
            <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
              <Lock className="w-3 h-3" /> Seed
            </span>
          )}
        </p>
        <button type="button" className={btn.secondary} onClick={onClose}>
          Close
        </button>
      </div>
      <ErrorBox error={error} onDismiss={() => setError(null)} />
      {creating && (
        <label className="block text-sm text-slate-600">
          Name
          <input className={`${input} mt-1`} value={form.name} maxLength={100} disabled={disabled} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
      )}
      <label className="block text-sm text-slate-600">
        Description
        <textarea
          className={`${input} mt-1`}
          rows={3}
          maxLength={400}
          value={form.description}
          disabled={disabled || seed}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </label>
      {seed && (
        <p className="text-xs text-slate-500" data-testid="seed-note">
          This is one of the benchmark seed descriptions the matching threshold was calibrated on, so it is read-only. Aliases and the category can still be changed.
        </p>
      )}
      <label className="block text-sm text-slate-600">
        Aliases (comma-separated)
        <input className={`${input} mt-1`} value={form.aliases} disabled={disabled} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
      </label>
      <label className="block text-sm text-slate-600">
        Category
        <select className={`${input} mt-1`} value={form.category} disabled={disabled} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {check && (
        <div className={`rounded-lg px-4 py-2 text-sm ${check.valid ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`} data-testid="skill-check">
          {check.valid ? (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Passes the checks
            </span>
          ) : (
            <ul className="list-disc ml-5">
              {(check.errors || []).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" className={btn.secondary} disabled={disabled || nothing} onClick={runCheck}>
          Check
        </button>
        <button type="button" className={btn.primary} disabled={disabled || nothing || (creating && !form.name.trim())} onClick={save}>
          {saving ? 'Saving…' : creating ? 'Create skill' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function SkillTaxonomyTab({ lock }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // a skill, 'new', or null

  const load = useCallback(async () => {
    const params = { page, limit: 50 };
    if (search.trim()) params.search = search.trim();
    if (category) params.category = category;
    try {
      setResult(await taxonomyService.listSkills(params));
      setError(null);
    } catch (err) {
      setError(taxonomyError(err));
      setResult({ data: [], categories: [] });
    }
  }, [search, category, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const categories = result?.categories || [];

  return (
    <div className="grid xl:grid-cols-2 gap-5">
      <div className="space-y-3">
        <div className={`${card} p-4 grid grid-cols-3 gap-3 items-end`}>
          <label className="col-span-3 md:col-span-1 text-sm text-slate-600">
            <span className="flex items-center gap-1">
              <Search className="w-3.5 h-3.5" /> Search
            </span>
            <input
              className={`${input} mt-1`}
              aria-label="Search skills"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
            />
          </label>
          <label className="text-sm text-slate-600">
            Category
            <select
              className={`${input} mt-1`}
              value={category}
              onChange={(e) => {
                setPage(1);
                setCategory(e.target.value);
              }}
            >
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={btn.primary} disabled={Boolean(lock)} onClick={() => setEditing('new')}>
            <Plus className="w-4 h-4" /> New skill
          </button>
        </div>
        <ErrorBox error={error} />
        <div className={`${card} overflow-hidden`}>
          {result === null ? (
            <Loading />
          ) : result.data.length === 0 ? (
            <p className="text-center py-10 text-slate-400 text-sm">No skills match.</p>
          ) : (
            <ul>
              {result.data.map((s) => (
                <li key={s.name} className="border-b border-slate-100">
                  <button type="button" className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50" data-testid="skill-row" onClick={() => setEditing(s)}>
                    <span className="flex items-center gap-2 text-slate-800">
                      {s.name}
                      {s.seed && <Lock className="w-3 h-3 text-slate-400" aria-label="Seed (read-only description)" />}
                      <span className="text-xs text-slate-400">{s.category || ''}</span>
                    </span>
                    <span className="block text-xs text-slate-500 truncate">{s.description || 'No description'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Pagination pagination={result?.pagination} onPage={setPage} />
        </div>
      </div>
      <div>
        {editing ? (
          <SkillEditor
            key={editing === 'new' ? 'new' : editing.name}
            skill={editing === 'new' ? null : editing}
            categories={categories}
            lock={lock}
            onClose={() => setEditing(null)}
            onSaved={(skill) => {
              setEditing(skill || null);
              load();
            }}
          />
        ) : (
          <p className="text-sm text-slate-500">Select a skill to edit it, or add a new one.</p>
        )}
      </div>
    </div>
  );
}
