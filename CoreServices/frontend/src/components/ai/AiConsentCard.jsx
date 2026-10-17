import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { aiService } from '../../services/aiService.js';

// Account page: the user's AI consent (12). Withdrawing turns AI writing help off and deletes the
// user's saved AI suggestions in AIServices.
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function AiConsentCard() {
  const [consent, setConsent] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    aiService.getConsent().then(setConsent).catch(() => setError('Could not load your AI settings.'));
  }, []);

  const act = async (fn, done) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setConsent(await fn());
      setMessage(done);
    } catch (err) {
      if (err.data) setConsent(err.data);
      setError(err.code === 'CONSENT_VERSION_CHANGED' ? 'The notice has changed — please read it again.' : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="card p-6" data-testid="ai-consent-card">
      <h3 className="text-base font-semibold text-slate-900 mb-3 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-500" aria-hidden="true" /> AI writing help
      </h3>
      {!consent && !error && <p className="text-sm text-slate-400">Loading…</p>}
      {consent && (
        <div className="space-y-3 text-sm">
          <p className="text-slate-700" data-testid="ai-consent-status">
            {consent.granted
              ? `On — you agreed on ${formatDate(consent.grantedAt)}.`
              : 'Off — AI writing help in the CV generator is not used.'}
          </p>
          <p className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-violet-900">{consent.text}</p>
          {consent.granted ? (
            confirming ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2" role="alertdialog" aria-label="Withdraw AI consent">
                <p className="text-red-800">This turns AI writing help off and deletes your saved AI suggestions. Continue?</p>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary text-sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
                  <button type="button" className="btn-primary text-sm bg-red-600 hover:bg-red-700" disabled={busy}
                    onClick={() => act(aiService.withdrawConsent, 'AI writing help is off and your saved AI suggestions are being deleted.')}>
                    {busy ? 'Withdrawing…' : 'Withdraw consent'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-secondary text-sm" onClick={() => setConfirming(true)}>Withdraw consent</button>
            )
          ) : (
            <button type="button" className="btn-primary text-sm" disabled={busy}
              onClick={() => act(() => aiService.giveConsent(consent.currentVersion), 'AI writing help is on.')}>
              {busy ? 'Saving…' : 'Agree and turn on'}
            </button>
          )}
        </div>
      )}
      {message && <p className="text-sm text-emerald-700 mt-3" role="status">{message}</p>}
      {error && <p className="text-sm text-red-700 mt-3" role="alert">{error}</p>}
    </div>
  );
}
