import React from 'react';
import { Sparkles } from 'lucide-react';
import { CV_ASSIST_AVAILABLE } from '../../services/cvAssistService.js';

// Placeholder for future LLM-assisted writing. Disabled until the AI service
// integration exists — it performs no action and returns no generated text.
export default function AiAssistButton({ label }) {
  return (
    <button
      type="button"
      disabled={!CV_ASSIST_AVAILABLE}
      title="AI writing assistance is coming soon"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-dashed border-violet-200 text-xs font-medium text-violet-400 bg-violet-50/50 cursor-not-allowed"
    >
      <Sparkles className="w-3.5 h-3.5" />
      {label}
      <span className="text-[10px] uppercase tracking-wide bg-violet-100 text-violet-500 px-1.5 py-0.5 rounded">
        Soon
      </span>
    </button>
  );
}
