import React from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';

// One-time consent before an AI feature sends CV / profile text to the provider (12). The notice text
// comes from the server, so the dialog always shows exactly what the user agrees to. "Not now" closes
// the dialog; every non-AI CV feature keeps working.
export default function AiConsentDialog({ consent, busy, error, onAgree, onNotNow }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-modal="true"
      aria-labelledby="ai-consent-title" data-testid="ai-consent-dialog">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4">
        <h2 id="ai-consent-title" className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-violet-500" aria-hidden="true" /> Use AI writing help?
        </h2>
        <p className="text-sm text-slate-600">
          AI can suggest better wording for your CV, using only what is already in your profile. You see every suggestion
          side by side with your own text and decide whether to use it.
        </p>
        <p className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900" data-testid="ai-consent-text">
          {consent?.text}
        </p>
        <ul className="text-xs text-slate-500 space-y-1">
          <li className="flex gap-2"><ShieldCheck className="w-4 h-4 flex-shrink-0 text-emerald-600" aria-hidden="true" />
            Your name, e-mail, phone number, address, links and photo are never sent.</li>
          <li className="flex gap-2"><ShieldCheck className="w-4 h-4 flex-shrink-0 text-emerald-600" aria-hidden="true" />
            You can withdraw this at any time on your Account page; saved AI suggestions are then deleted.</li>
        </ul>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary text-sm" onClick={onNotNow} disabled={busy}>Not now</button>
          <button type="button" className="btn-primary text-sm" onClick={onAgree} disabled={busy || !consent?.currentVersion}>
            {busy ? 'Saving…' : 'Agree'}
          </button>
        </div>
      </div>
    </div>
  );
}
