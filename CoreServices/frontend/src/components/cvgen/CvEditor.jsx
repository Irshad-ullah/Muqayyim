import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Plus,
  Trash2,
  User,
  FileText,
  Zap,
  Briefcase,
  GraduationCap,
  Code2,
  Award,
} from 'lucide-react';
import { CvAssistActions, CvAssistProvider } from './CvAssist.jsx';
import { EMPTY_ITEMS, SECTION_LABELS, formatRange } from './cvModel.js';

// Module 4 — content editor. Every edit goes through `onChange(nextData)`; the
// page owns the state and the live preview re-renders from it.

// ── Small inputs ─────────────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, required, type = 'text', maxLength }) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <input
        type={type}
        className="input-field"
        value={value || ''}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder, rows = 4, maxLength, hint, actions }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {actions && <div className="flex gap-1.5 flex-wrap">{actions}</div>}
      </div>
      <textarea
        className="input-field resize-y"
        rows={rows}
        value={value || ''}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="flex justify-between mt-1">
        <span className="text-xs text-slate-400">{hint}</span>
        {maxLength && (
          <span className="text-xs text-slate-400">
            {(value || '').length}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
}

// Comma-separated list input that keeps the raw text while typing.
const parseList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
function CommaListInput({ label, value, onChange, placeholder }) {
  const [text, setText] = useState((value || []).join(', '));
  useEffect(() => {
    if (parseList(text).join('|') !== (value || []).join('|')) setText((value || []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className="input-field"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseList(e.target.value));
        }}
      />
    </label>
  );
}

// ── Section card ─────────────────────────────────────────────────────────────
function SectionCard({ icon: Icon, title, count, open, onToggle, children }) {
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-indigo-600" />
        </div>
        <span className="flex-1 text-sm font-bold text-slate-800">{title}</span>
        {count !== undefined && (
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{count}</span>
        )}
        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>
      {open && <div className="px-5 pb-5 pt-1 border-t border-slate-100 space-y-4">{children}</div>}
    </div>
  );
}

// ── Generic list editor (experience, education, projects, certifications) ────
function ListEditor({ items, onChange, makeItem, summarize, renderFields, addLabel, emptyText }) {
  const [openId, setOpenId] = useState(null);

  const update = (id, patch) => onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const remove = (id) => onChange(items.filter((it) => it.id !== id));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () => {
    const item = makeItem();
    onChange([...items, item]);
    setOpenId(item.id);
  };

  return (
    <div className="space-y-2">
      {!items.length && <p className="text-sm text-slate-400 italic">{emptyText}</p>}
      {items.map((it, i) => {
        const open = openId === it.id;
        const { primary, secondary } = summarize(it);
        return (
          <div key={it.id} className="border border-slate-200 rounded-xl">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button type="button" onClick={() => setOpenId(open ? null : it.id)} className="flex-1 min-w-0 text-left">
                <p className={`text-sm font-semibold truncate ${primary ? 'text-slate-800' : 'text-slate-400 italic'}`}>
                  {primary || 'Untitled'}
                </p>
                {secondary && <p className="text-xs text-slate-500 truncate">{secondary}</p>}
              </button>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="Move up">
                <ChevronUp className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="Move down">
                <ChevronDown className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => remove(it.id)} className="p-1 text-slate-400 hover:text-red-600" title="Remove">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {open && (
              <div className="px-3 pb-3 pt-1 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {renderFields(it, (patch) => update(it.id, patch))}
              </div>
            )}
          </div>
        );
      })}
      <button type="button" onClick={add} className="btn-secondary w-full text-sm py-2">
        <Plus className="w-4 h-4" /> {addLabel}
      </button>
    </div>
  );
}

const DATE_HINT = 'e.g. 2024-06 or Jun 2024';
const full = 'sm:col-span-2';

// ── Main editor ──────────────────────────────────────────────────────────────
export default function CvEditor({ data, onChange }) {
  const [open, setOpen] = useState('personal');
  const toggle = (key) => setOpen((o) => (o === key ? null : key));
  const set = (key, value) => onChange({ ...data, [key]: value });
  const setPersonal = (patch) => set('personal', { ...data.personal, ...patch });
  const pi = data.personal || {};

  return (
    <CvAssistProvider>
    <div className="space-y-3">
      <SectionCard icon={User} title="Personal Information" open={open === 'personal'} onToggle={() => toggle('personal')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Full name" required value={pi.fullName} maxLength={120} onChange={(v) => setPersonal({ fullName: v })} />
          <Field label="Headline / target role" value={pi.headline} maxLength={160} placeholder="e.g. Full-Stack Developer" onChange={(v) => setPersonal({ headline: v })} />
          <Field label="Email" type="email" value={pi.email} maxLength={200} onChange={(v) => setPersonal({ email: v })} />
          <Field label="Phone" value={pi.phone} maxLength={60} onChange={(v) => setPersonal({ phone: v })} />
          <Field label="Location" value={pi.location} maxLength={200} onChange={(v) => setPersonal({ location: v })} />
          <Field label="LinkedIn" value={pi.linkedin} placeholder="linkedin.com/in/…" onChange={(v) => setPersonal({ linkedin: v })} />
          <Field label="GitHub" value={pi.github} placeholder="github.com/…" onChange={(v) => setPersonal({ github: v })} />
          <Field label="Portfolio / website" value={pi.website} placeholder="https://…" onChange={(v) => setPersonal({ website: v })} />
        </div>
        <p className="text-xs text-slate-400">Only filled-in fields appear on the CV.</p>
      </SectionCard>

      <SectionCard icon={FileText} title={SECTION_LABELS.summary} open={open === 'summary'} onToggle={() => toggle('summary')}>
        <TextArea
          label="Summary"
          value={data.summary}
          maxLength={2000}
          rows={5}
          placeholder="A short overview of your experience and strengths."
          onChange={(v) => set('summary', v)}
          actions={<CvAssistActions target="summary" currentText={data.summary} onApply={(v) => set('summary', v)} />}
        />
      </SectionCard>

      <SectionCard
        icon={Zap}
        title={SECTION_LABELS.skills}
        count={data.skills.reduce((n, g) => n + g.items.length, 0)}
        open={open === 'skills'}
        onToggle={() => toggle('skills')}
      >
        <ListEditor
          items={data.skills}
          onChange={(v) => set('skills', v)}
          makeItem={EMPTY_ITEMS.skills}
          addLabel="Add skill group"
          emptyText="No skills yet."
          summarize={(g) => ({ primary: g.category || 'Skills', secondary: g.items.join(', ') })}
          renderFields={(g, update) => (
            <>
              <div className={full}>
                <Field label="Category" value={g.category} maxLength={80} placeholder="e.g. Programming Languages" onChange={(v) => update({ category: v })} />
              </div>
              <div className={full}>
                <CommaListInput label="Skills (comma separated)" value={g.items} onChange={(v) => update({ items: v })} />
              </div>
            </>
          )}
        />
      </SectionCard>

      <SectionCard
        icon={Briefcase}
        title={SECTION_LABELS.experience}
        count={data.experience.length}
        open={open === 'experience'}
        onToggle={() => toggle('experience')}
      >
        <ListEditor
          items={data.experience}
          onChange={(v) => set('experience', v)}
          makeItem={EMPTY_ITEMS.experience}
          addLabel="Add experience"
          emptyText="No work experience — the section is left out of the CV."
          summarize={(e) => ({
            primary: [e.title, e.company].filter(Boolean).join(' at '),
            secondary: formatRange(e.startDate, e.endDate, e.current),
          })}
          renderFields={(e, update) => (
            <>
              <Field label="Job title" value={e.title} maxLength={200} onChange={(v) => update({ title: v })} />
              <Field label="Company" value={e.company} maxLength={200} onChange={(v) => update({ company: v })} />
              <Field label="Location" value={e.location} maxLength={200} onChange={(v) => update({ location: v })} />
              <div />
              <Field label="Start date" value={e.startDate} maxLength={40} placeholder={DATE_HINT} onChange={(v) => update({ startDate: v })} />
              <div>
                <Field label="End date" value={e.current ? '' : e.endDate} maxLength={40} placeholder={e.current ? 'Present' : DATE_HINT} onChange={(v) => update({ endDate: v, current: false })} />
                <label className="flex items-center gap-2 mt-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={!!e.current} onChange={(ev) => update({ current: ev.target.checked })} />
                  I currently work here
                </label>
              </div>
              <div className={full}>
                <TextArea
                  label="Responsibilities / achievements"
                  value={e.description}
                  maxLength={4000}
                  hint="One bullet per line"
                  onChange={(v) => update({ description: v })}
                  actions={<CvAssistActions target="experience" entry={e} currentText={e.description}
                    onApply={(v) => update({ description: v })} />}
                />
              </div>
            </>
          )}
        />
      </SectionCard>

      <SectionCard
        icon={Code2}
        title={SECTION_LABELS.projects}
        count={data.projects.length}
        open={open === 'projects'}
        onToggle={() => toggle('projects')}
      >
        <ListEditor
          items={data.projects}
          onChange={(v) => set('projects', v)}
          makeItem={EMPTY_ITEMS.projects}
          addLabel="Add project"
          emptyText="No projects — the section is left out of the CV."
          summarize={(p) => ({
            primary: p.name,
            secondary: [p.source === 'github' ? 'GitHub' : p.source === 'cv' ? 'From CV' : '', p.technologies.join(', ')]
              .filter(Boolean)
              .join(' · '),
          })}
          renderFields={(p, update) => (
            <>
              <div className={full}>
                <Field label="Project name" value={p.name} maxLength={200} onChange={(v) => update({ name: v })} />
              </div>
              <Field label="Repository URL" value={p.url} placeholder="github.com/…" onChange={(v) => update({ url: v })} />
              <Field label="Live / demo URL" value={p.liveUrl} placeholder="https://…" onChange={(v) => update({ liveUrl: v })} />
              <div className={full}>
                <CommaListInput label="Technologies (comma separated)" value={p.technologies} onChange={(v) => update({ technologies: v })} />
              </div>
              <div className={full}>
                <TextArea
                  label="Description"
                  value={p.description}
                  maxLength={3000}
                  hint="Paragraph, or one bullet per line"
                  onChange={(v) => update({ description: v })}
                  actions={<CvAssistActions target="project" entry={p} currentText={p.description}
                    onApply={(v) => update({ description: v })} />}
                />
              </div>
            </>
          )}
        />
      </SectionCard>

      <SectionCard
        icon={GraduationCap}
        title={SECTION_LABELS.education}
        count={data.education.length}
        open={open === 'education'}
        onToggle={() => toggle('education')}
      >
        <ListEditor
          items={data.education}
          onChange={(v) => set('education', v)}
          makeItem={EMPTY_ITEMS.education}
          addLabel="Add education"
          emptyText="No education entries."
          summarize={(e) => ({
            primary: [e.degree, e.field].filter(Boolean).join(', ') || e.institution,
            secondary: [e.degree || e.field ? e.institution : '', formatRange(e.startDate, e.endDate)].filter(Boolean).join(' · '),
          })}
          renderFields={(e, update) => (
            <>
              <Field label="Degree" value={e.degree} maxLength={200} placeholder="e.g. BS" onChange={(v) => update({ degree: v })} />
              <Field label="Field of study" value={e.field} maxLength={200} onChange={(v) => update({ field: v })} />
              <Field label="Institution" value={e.institution} maxLength={200} onChange={(v) => update({ institution: v })} />
              <Field label="Location" value={e.location} maxLength={200} onChange={(v) => update({ location: v })} />
              <Field label="Start" value={e.startDate} maxLength={40} placeholder={DATE_HINT} onChange={(v) => update({ startDate: v })} />
              <Field label="End" value={e.endDate} maxLength={40} placeholder={DATE_HINT} onChange={(v) => update({ endDate: v })} />
              <Field label="GPA / grade" value={e.gpa} maxLength={40} onChange={(v) => update({ gpa: v })} />
              <div className={full}>
                <TextArea label="Details (optional)" value={e.details} rows={2} maxLength={1000} hint="Coursework, honours…" onChange={(v) => update({ details: v })} />
              </div>
            </>
          )}
        />
      </SectionCard>

      <SectionCard
        icon={Award}
        title={SECTION_LABELS.certifications}
        count={data.certifications.length}
        open={open === 'certifications'}
        onToggle={() => toggle('certifications')}
      >
        <ListEditor
          items={data.certifications}
          onChange={(v) => set('certifications', v)}
          makeItem={EMPTY_ITEMS.certifications}
          addLabel="Add certification"
          emptyText="No certifications — the section is left out of the CV."
          summarize={(c) => ({ primary: c.name, secondary: c.issuer })}
          renderFields={(c, update) => (
            <>
              <Field label="Certification name" value={c.name} maxLength={200} onChange={(v) => update({ name: v })} />
              <Field label="Issuer" value={c.issuer} maxLength={200} onChange={(v) => update({ issuer: v })} />
              <Field label="Date" value={c.date} maxLength={40} placeholder={DATE_HINT} onChange={(v) => update({ date: v })} />
              <Field label="Credential URL" value={c.url} placeholder="https://…" onChange={(v) => update({ url: v })} />
            </>
          )}
        />
      </SectionCard>
    </div>
    </CvAssistProvider>
  );
}
