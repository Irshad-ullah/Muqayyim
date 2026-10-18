import React, { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import AiConsentDialog from '../../components/ai/AiConsentDialog.jsx';
import { aiService } from '../../services/aiService.js';
import { learningPathService } from '../../services/learningPathService.js';
import { errorView } from './pathRules.js';

// Module 6 (FR7.7 / FR8.1): set up a learning path for one career — the alternative to learn for each any-of
// requirement, language, free or paid resources, hours per week. Creating needs the current AI consent; when the
// server asks for it, the consent dialog appears and the request is repeated after "Agree".

export const groupsOf = (member) => (member?.required || [])
  .filter((r) => r.status === 'missing' && r.group?.alternatives?.length > 1)
  .map((r) => ({ key: r.key, label: r.group.phrase || r.name, alternatives: r.group.alternatives }));

const keyOf = (name) => name.trim().toLowerCase();

export default function GeneratePathDialog({ professionId, title, member, onClose }) {
  const id = useId();
  const navigate = useNavigate();
  const groups = groupsOf(member);
  const [choices, setChoices] = useState(() => Object.fromEntries(groups.map((g) => [g.key, keyOf(g.alternatives[0])])));
  const [preferences, setPreferences] = useState({ language: 'English', cost: 'free', hoursPerWeek: 5 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [consent, setConsent] = useState(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await learningPathService.create({ professionId, choices, preferences });
      navigate(`/learning-paths/${path.id}`);
    } catch (err) {
      if (err.code === 'AI_CONSENT_REQUIRED') setConsent(err.data);
      else setError(errorView(err));
    } finally {
      setBusy(false);
    }
  };

  const agree = async () => {
    setBusy(true);
    try {
      await aiService.giveConsent(consent.currentVersion);
      setConsent(null);
      await create();
    } catch (err) {
      setError(errorView(err));
      setBusy(false);
    }
  };

  if (consent) {
    return <AiConsentDialog consent={consent} busy={busy} onAgree={agree} onNotNow={() => setConsent(null)} />;
  }
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-modal="true"
      aria-labelledby={`${id}-title`} data-testid="generate-path-dialog">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-indigo-600" aria-hidden="true" /> Learning path for {title}
        </h2>
        {groups.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Which one do you want to learn?</legend>
            {groups.map((g) => (
              <label key={g.key} className="block text-sm text-slate-600">
                {g.label}
                <select className="input-field mt-1" value={choices[g.key]} onChange={(e) => setChoices({ ...choices, [g.key]: e.target.value })}>
                  {g.alternatives.map((a) => <option key={a} value={keyOf(a)}>{a}</option>)}
                </select>
              </label>
            ))}
          </fieldset>
        )}
        <div className="grid grid-cols-3 gap-3">
          <label className="text-sm text-slate-600">Language
            <select className="input-field mt-1" value={preferences.language} onChange={(e) => setPreferences({ ...preferences, language: e.target.value })}>
              <option value="English">English</option>
              <option value="Urdu-Hindi">Urdu-Hindi</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">Resources
            <select className="input-field mt-1" value={preferences.cost} onChange={(e) => setPreferences({ ...preferences, cost: e.target.value })}>
              <option value="free">Free only</option>
              <option value="include_paid">Include paid</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">Hours per week
            <input type="number" min={1} max={60} className="input-field mt-1" value={preferences.hoursPerWeek}
              onChange={(e) => setPreferences({ ...preferences, hoursPerWeek: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          The order of the modules is worked out from your skills and this career. AI then describes each module and suggests
          resources; links open a search on the platform, so you can check each one.
        </p>
        {error && <p className="text-sm text-red-700" role="alert"><strong>{error.title}.</strong> {error.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary text-sm" onClick={create} disabled={busy}>
            {busy ? 'Building your path…' : 'Create learning path'}
          </button>
        </div>
      </div>
    </div>
  );
}
