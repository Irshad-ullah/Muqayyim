import React from 'react';
import { Sparkles } from 'lucide-react';

// An AI writing-assistance button (Generate / Improve). The behaviour lives in CvAssist.jsx.
export default function AiAssistButton({ label, onClick, disabled, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-violet-200 text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
