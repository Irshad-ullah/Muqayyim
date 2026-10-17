import React, { useState } from 'react';
import { AlertTriangle, Check, Pencil, X } from 'lucide-react';
import { flagSegments } from '../../services/cvAssistService.js';

// Review step for an AI suggestion (12): the current text and the suggestion side by side; anything the
// suggestion contains that your input does not is highlighted with the reason. Accept puts the (possibly
// edited) suggestion into the editor — nothing is saved automatically; Discard keeps your text.
export default function AssistReview({ title, current, suggestion, flags, onAccept, onDiscard }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(suggestion);
  const edited = draft !== suggestion;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-modal="true"
      aria-labelledby="assist-review-title" data-testid="assist-review">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-auto p-6 space-y-4">
        <h2 id="assist-review-title" className="text-lg font-semibold text-slate-900">Review the AI suggestion — {title}</h2>

        <div className="grid md:grid-cols-2 gap-4">
          <section aria-label="Your current text">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Your current text</h3>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap min-h-[6rem]" data-testid="review-current">
              {current || <span className="text-slate-400">(empty)</span>}
            </div>
          </section>
          <section aria-label="AI suggestion">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              AI suggestion{edited ? ' (edited by you)' : ''}
            </h3>
            {editing ? (
              <textarea className="input-field resize-y min-h-[10rem] text-sm" value={draft} aria-label="Edit the suggestion"
                onChange={(e) => setDraft(e.target.value)} />
            ) : (
              <div className="rounded-xl border border-violet-200 bg-white p-3 text-sm text-slate-800 whitespace-pre-wrap min-h-[6rem]" data-testid="review-suggestion">
                {edited ? draft : flagSegments(suggestion, flags).map((part, i) => (part.flag ? (
                  <mark key={i} className="bg-amber-100 text-amber-900 rounded px-0.5 underline decoration-amber-500 decoration-2"
                    title={part.flag.reason} data-testid="flagged">
                    {part.text}<span className="sr-only"> ({part.flag.reason})</span>
                  </mark>
                ) : <React.Fragment key={i}>{part.text}</React.Fragment>))}
              </div>
            )}
          </section>
        </div>

        {flags.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="review-flags">
            <p className="font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4" aria-hidden="true" />
              Check {flags.length === 1 ? 'this item' : `these ${flags.length} items`} — they are not in your profile or your text:</p>
            <ul className="list-disc ml-6 mt-1 space-y-0.5">
              {flags.map((f) => <li key={`${f.start}-${f.text}`}><strong>{f.text}</strong> — {f.reason}</li>)}
            </ul>
            <p className="mt-1 text-xs">Remove or correct anything that is not true before you accept.</p>
          </div>
        ) : (
          <p className="text-xs text-slate-500" data-testid="review-no-flags">Every name, skill and number in the suggestion is in your profile or your text.</p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1.5" onClick={onDiscard}>
            <X className="w-4 h-4" aria-hidden="true" /> Discard
          </button>
          <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1.5" onClick={() => setEditing((e) => !e)}>
            <Pencil className="w-4 h-4" aria-hidden="true" /> {editing ? 'Done editing' : 'Edit before accepting'}
          </button>
          <button type="button" className="btn-primary text-sm inline-flex items-center gap-1.5" onClick={() => onAccept(draft)}
            disabled={!draft.trim()}>
            <Check className="w-4 h-4" aria-hidden="true" /> Accept
          </button>
        </div>
        <p className="text-[11px] text-slate-400 text-right">Accepting only changes the editor; save the CV as usual to keep it.</p>
      </div>
    </div>
  );
}
