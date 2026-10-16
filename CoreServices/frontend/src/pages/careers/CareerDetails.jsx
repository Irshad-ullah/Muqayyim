import React, { useId, useState } from 'react';
import { CheckCircle2, CircleDashed, GraduationCap, Info, XCircle } from 'lucide-react';
import { ESCO_NOTE, SOURCE_NAMES, formatScore, skillNote } from './careerRules.js';

// Details of one career (FR7.4–FR7.7): required skills marked held / related / missing (icon +
// text, never colour alone), optional skills, the explanation, the sources with attribution, and
// "Generate learning path" (Module 6, coming soon) with the gap count.

const ICONS = { matched: CheckCircle2, related: CircleDashed, missing: XCircle };
const TONES = { matched: 'text-emerald-700', related: 'text-amber-700', missing: 'text-rose-700' };

export function SourceBadge({ source }) {
  return (
    <span className="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
      {SOURCE_NAMES[source] || source}
    </span>
  );
}

export function EscoInfo() {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="About ESCO scores"
        aria-describedby={id}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-slate-400 hover:text-slate-600"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      <span
        id={id}
        role="tooltip"
        className={`${open ? 'block' : 'sr-only'} absolute z-10 left-5 top-0 w-64 rounded-lg bg-slate-800 text-white text-xs p-2 shadow`}
      >
        {ESCO_NOTE}
      </span>
    </span>
  );
}

// The status is always in words ("Held — from your CV", "Related — via your …", "Missing"),
// next to an icon; colour only repeats it.
function SkillRow({ row }) {
  const Icon = ICONS[row.status];
  return (
    <li className="flex items-start gap-2 py-1.5" data-testid="skill-row" data-status={row.status}>
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${TONES[row.status]}`} aria-hidden="true" />
      <div className="min-w-0">
        <span className="text-sm text-slate-800">{row.name}</span>
        <p className={`text-xs ${TONES[row.status]}`}>{skillNote(row)}</p>
      </div>
    </li>
  );
}

function MemberSection({ member, merged }) {
  const optionalId = useId();
  return (
    <section className="space-y-4" aria-label={`${SOURCE_NAMES[member.source] || member.source} details`} data-testid="member">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          {merged ? `${SOURCE_NAMES[member.source]} list` : member.title}
          <SourceBadge source={member.source} />
          {member.source === 'esco' && <EscoInfo />}
        </h3>
        <span className="text-sm font-semibold text-slate-700">{formatScore(member.score)} match</span>
      </div>
      {merged && <p className="text-xs text-slate-500">{member.title}</p>}

      <div className="space-y-1" data-testid="explanation">
        {member.explanation.map((line) => (
          <p key={line} className="text-sm text-slate-600">{line}</p>
        ))}
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Required skills ({member.matched} held, {member.related} related, {member.missing} missing)
        </h4>
        <ul className="divide-y divide-slate-100" aria-label="Required skills">
          {member.required.map((row) => <SkillRow key={row.key} row={row} />)}
        </ul>
      </div>

      {member.optional.length > 0 && (
        <details>
          <summary id={optionalId} className="text-xs font-semibold uppercase tracking-wide text-slate-500 cursor-pointer">
            Optional skills ({member.optional.length}, not counted in the match %)
          </summary>
          <ul className="divide-y divide-slate-100" aria-labelledby={optionalId}>
            {member.optional.map((row) => <SkillRow key={row.key} row={row} />)}
          </ul>
        </details>
      )}

      <p className="text-[11px] text-slate-400" data-testid="attribution">{member.attribution}</p>
    </section>
  );
}

export default function CareerDetails({ detail }) {
  const merged = detail.members.length > 1;
  const gaps = new Set(detail.members.flatMap((m) => m.gaps));
  return (
    <article className="card p-6 space-y-6" aria-labelledby="career-title" data-testid="career-details">
      <header className="space-y-1">
        <h2 id="career-title" className="text-lg font-bold text-slate-900">{detail.title}</h2>
        <p className="text-sm text-slate-500 flex items-center gap-2 flex-wrap">
          <span>{formatScore(detail.score)} match · ranked {detail.rank} of {detail.of}</span>
          <span aria-hidden="true">·</span>
          <span>{detail.categories?.join(' / ') || detail.category}</span>
          {detail.sources.map((s) => <SourceBadge key={s.profession_id} source={s.source} />)}
        </p>
        {merged && (
          <p className="text-xs text-slate-500" data-testid="merged-note">
            Listed by both {detail.sources.map((s) => SOURCE_NAMES[s.source]).join(' and ')}; the match shown is the higher one.
          </p>
        )}
      </header>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-700">
          <strong>{gaps.size}</strong> skill{gaps.size === 1 ? '' : 's'} to learn for this career
        </p>
        <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2" disabled aria-disabled="true">
          <GraduationCap className="w-4 h-4" aria-hidden="true" /> Generate learning path (coming soon)
        </button>
      </div>

      {detail.members.map((member, i) => (
        <React.Fragment key={member.profession_id}>
          {i > 0 && <hr className="border-slate-200" />}
          <MemberSection member={member} merged={merged} />
        </React.Fragment>
      ))}
    </article>
  );
}
