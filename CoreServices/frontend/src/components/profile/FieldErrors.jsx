import React from 'react';
import { AlertCircle } from 'lucide-react';
import { describeField } from '../../validation/validateProfile.js';

// Inline message under a field. `id` lets the input point at it with
// aria-describedby so screen readers announce the error.
export function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-red-600 mt-1">
      {message}
    </p>
  );
}

// Props for an input that may have an error: red border + aria wiring.
export const errorProps = (field, message) => ({
  'aria-invalid': message ? true : undefined,
  'aria-describedby': message ? `err-${field}` : undefined,
});

export const errorClass = (message) => (message ? ' border-red-400 focus:ring-red-400' : '');

// Summary of every error on the current step, shown above its content.
export function StepErrors({ errors }) {
  if (!errors?.length) return null;
  return (
    <div className="flex items-start gap-3 p-3 mb-5 bg-red-50 rounded-xl border border-red-100" data-testid="step-errors">
      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
      <div className="text-xs text-red-700">
        <p className="font-semibold">Fix the following before saving:</p>
        <ul className="list-disc ml-4 mt-1 space-y-0.5">
          {errors.map((e) => (
            <li key={`${e.field}:${e.message}`}>
              <span className="font-medium">{describeField(e.field)}:</span> {e.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
