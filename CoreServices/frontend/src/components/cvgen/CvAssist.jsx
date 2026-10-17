import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { aiService } from '../../services/aiService.js';
import { UNCHANGED, assistErrorView, assistRequest } from '../../services/cvAssistService.js';
import AiConsentDialog from '../ai/AiConsentDialog.jsx';
import AssistReview from '../ai/AssistReview.jsx';
import AiAssistButton from './AiAssistButton.jsx';

// CV assist in the editor (12 Part 2): availability and consent are loaded once; each Generate /
// Improve pair asks for consent the first time, calls the server, and opens the review step. An
// accepted suggestion only replaces the editor text (through `onApply`); nothing is saved here.

const AssistContext = createContext(null);
const TITLES = { summary: 'Summary', experience: 'Responsibilities / achievements', project: 'Project description' };

export function CvAssistProvider({ children }) {
  const [available, setAvailable] = useState(null); // null = loading
  const [consent, setConsent] = useState(null);
  const [dialog, setDialog] = useState(null); // { pending } while the consent dialog is open
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [review, setReview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([aiService.getStatus().catch(() => ({ available: false })), aiService.getConsent().catch(() => null)])
      .then(([status, state]) => {
        if (cancelled) return;
        setAvailable(Boolean(status?.available));
        setConsent(state);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Runs one assist request → the review step, or an error view (the user's text is never touched).
  const run = useCallback(async (job) => {
    try {
      const result = await aiService.cvAssist(assistRequest(job.target, job.mode, job));
      if (result.insufficientData || !result.suggestion) {
        return { kind: 'insufficient', message: 'There is not enough information in your profile to write this yet. ' + UNCHANGED };
      }
      setReview({ ...job, suggestion: result.suggestion, flags: result.flags || [] });
      return null;
    } catch (error) {
      const view = assistErrorView(error);
      if (view.kind === 'consent') {
        if (error.data) setConsent(error.data);
        setDialog({ pending: job });
        return 'dialog';
      }
      return { ...view, message: `${view.message} ${UNCHANGED}` };
    }
  }, []);

  // → 'dialog' (the consent dialog took over and reports through job.onResult), an error / notice
  // view, or null (the review step is open).
  const request = useCallback(async (job) => {
    if (!consent?.granted) {
      setConsentError('');
      setDialog({ pending: job });
      return 'dialog';
    }
    return run(job);
  }, [consent, run]);

  const agree = async () => {
    setConsentBusy(true);
    setConsentError('');
    try {
      const state = await aiService.giveConsent(consent?.currentVersion);
      setConsent(state);
      const job = dialog?.pending;
      setDialog(null);
      if (job) {
        const outcome = await run(job);
        if (outcome !== 'dialog') job.onResult?.(outcome);
      }
    } catch (error) {
      if (error.data) setConsent(error.data);
      setConsentError(error.code === 'CONSENT_VERSION_CHANGED'
        ? 'The notice has changed — please read it again.' : 'Could not save your choice. Please try again.');
    } finally {
      setConsentBusy(false);
    }
  };

  const value = useMemo(() => ({ available, consent, request }), [available, consent, request]);
  return (
    <AssistContext.Provider value={value}>
      {children}
      {dialog && (
        <AiConsentDialog consent={consent} busy={consentBusy} error={consentError} onAgree={agree}
          onNotNow={() => { dialog.pending?.onResult?.(null); setDialog(null); }} />
      )}
      {review && (
        <AssistReview title={TITLES[review.target]} current={review.currentText} suggestion={review.suggestion} flags={review.flags}
          onDiscard={() => setReview(null)}
          onAccept={(text) => { review.onApply(text); setReview(null); }} />
      )}
    </AssistContext.Provider>
  );
}

// Generate / Improve for one text field. `entry` is the experience or project being edited.
export function CvAssistActions({ target, entry, currentText, onApply }) {
  const ctx = useContext(AssistContext);
  const [busy, setBusy] = useState(null); // 'generate' | 'improve'
  const [notice, setNotice] = useState(null);
  if (!ctx) return null;
  const { available } = ctx;
  const hasText = Boolean((currentText || '').trim());

  const click = async (mode) => {
    setNotice(null);
    setBusy(mode);
    const job = { target, mode, entry, currentText, onApply, onResult: (view) => { setNotice(view); setBusy(null); } };
    const outcome = await ctx.request(job);
    if (outcome !== 'dialog') job.onResult(outcome);
  };

  const unavailable = available === false;
  const reason = unavailable ? 'AI is unavailable right now' : undefined;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <AiAssistButton label={busy === 'generate' ? 'Writing…' : 'Generate'} onClick={() => click('generate')}
          disabled={available === null || unavailable || busy !== null} title={reason} />
        <AiAssistButton label={busy === 'improve' ? 'Improving…' : 'Improve'} onClick={() => click('improve')}
          disabled={available === null || unavailable || busy !== null || !hasText} title={reason || (!hasText ? 'Write some text first' : undefined)} />
      </div>
      {notice && <p className="text-xs text-red-700 max-w-xs text-right" role="alert" data-testid="assist-notice">{notice.message}</p>}
    </div>
  );
}
