import React from 'react';
import { ChevronUp, ChevronDown, Eye, EyeOff, Check, ShieldCheck } from 'lucide-react';
import { ACCENT_COLORS, ACCENT_LABELS, SECTION_LABELS, TEMPLATES, sectionHasContent } from './cvModel.js';

// Module 4 — design options. Only ATS-safe choices are offered: single-column
// templates, standard fonts, dark accent colours and section order/visibility.

function Group({ title, children }) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-bold text-slate-800 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex bg-slate-100 rounded-xl p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            value === o.value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function DesignPanel({ template, settings, data, onTemplate, onSettings }) {
  const set = (patch) => onSettings({ ...settings, ...patch });
  const order = settings.sectionOrder;
  const hidden = settings.hiddenSections;

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    set({ sectionOrder: next });
  };
  const toggleHidden = (key) =>
    set({ hiddenSections: hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key] });

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 p-4 bg-emerald-50 rounded-xl border border-emerald-100">
        <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-emerald-700">
          All templates are single-column with real, selectable text and standard headings, so
          Applicant Tracking Systems can read them reliably.
        </p>
      </div>

      <Group title="Template">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTemplate(t.id)}
              className={`text-left p-3 rounded-xl border transition-all ${
                template === t.id ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">{t.name}</span>
                {template === t.id && <Check className="w-4 h-4 text-indigo-600" />}
              </div>
              <p className="text-xs text-slate-500 mt-1">{t.description}</p>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Style">
        <div className="space-y-4">
          <div>
            <p className="label">Heading colour</p>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(ACCENT_COLORS).map(([key, hex]) => (
                <button
                  key={key}
                  type="button"
                  title={ACCENT_LABELS[key]}
                  aria-label={ACCENT_LABELS[key]}
                  onClick={() => set({ accentColor: key })}
                  className={`w-8 h-8 rounded-full flex items-center justify-center ring-offset-2 transition-all ${
                    settings.accentColor === key ? 'ring-2 ring-indigo-500' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: hex }}
                >
                  {settings.accentColor === key && <Check className="w-4 h-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-6 flex-wrap">
            <div>
              <p className="label">Font</p>
              <Segmented
                value={settings.fontFamily}
                onChange={(v) => set({ fontFamily: v })}
                options={[
                  { value: 'sans', label: 'Helvetica / Arial' },
                  { value: 'serif', label: 'Times' },
                ]}
              />
            </div>
            <div>
              <p className="label">Text size</p>
              <Segmented
                value={settings.fontSize}
                onChange={(v) => set({ fontSize: v })}
                options={[
                  { value: 'small', label: 'S' },
                  { value: 'medium', label: 'M' },
                  { value: 'large', label: 'L' },
                ]}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={settings.groupSkills} onChange={(e) => set({ groupSkills: e.target.checked })} />
            Group skills by category
          </label>
        </div>
      </Group>

      <Group title="Sections">
        <p className="text-xs text-slate-500 mb-3">Reorder sections or hide ones you don't want on this CV. Empty sections are skipped automatically.</p>
        <div className="space-y-1.5">
          {order.map((key, i) => {
            const isHidden = hidden.includes(key);
            const empty = !sectionHasContent(key, data);
            return (
              <div key={key} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-100 bg-slate-50">
                <span className={`flex-1 text-sm font-medium ${isHidden ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                  {SECTION_LABELS[key]}
                  {empty && <span className="ml-2 text-xs font-normal text-slate-400 no-underline">(empty)</span>}
                </span>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="Move up">
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="Move down">
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => toggleHidden(key)} className="p-1 text-slate-400 hover:text-slate-700" title={isHidden ? 'Show section' : 'Hide section'}>
                  {isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            );
          })}
        </div>
      </Group>
    </div>
  );
}
