import React from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { PASSWORD_CHECKS } from '../constants/passwordPolicy.js';

// Live checklist for the password policy (8–128 chars, a letter, a number).
export default function PasswordChecklist({ password }) {
  return (
    <ul className="mt-2 flex gap-x-3 gap-y-1 flex-wrap" aria-label="Password requirements">
      {PASSWORD_CHECKS.map(({ id, label, test }) => {
        const ok = test(password || '');
        return (
          <li
            key={id}
            className={`flex items-center gap-1 text-xs ${ok ? 'text-emerald-600' : 'text-slate-400'}`}
          >
            {ok ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
            {label}
          </li>
        );
      })}
    </ul>
  );
}
