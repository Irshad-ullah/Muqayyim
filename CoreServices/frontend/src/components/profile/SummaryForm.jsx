import React from 'react';

export default function SummaryForm({ data, onChange }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">Professional Summary</h2>
        <p className="text-sm text-slate-500">A short paragraph about who you are and what you bring to the table.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Summary</label>
        <textarea
          value={data || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Results-driven software engineer with 5 years of experience building scalable web applications. Passionate about clean architecture and developer tooling..."
          className="input-field h-40 resize-none leading-relaxed"
          maxLength={1000}
        />
        <p className="text-xs text-slate-400 mt-1 text-right">{(data || '').length} / 1000</p>
      </div>
    </div>
  );
}
