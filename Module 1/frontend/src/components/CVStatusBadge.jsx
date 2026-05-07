import React from 'react';
import { CheckCircle2, Upload, Cpu, FileX } from 'lucide-react';

const STATUS_CONFIG = {
  'Not Uploaded': {
    label: 'Not Uploaded',
    color: 'bg-slate-100 text-slate-600',
    dot: 'bg-slate-400',
    icon: FileX,
  },
  Uploaded: {
    label: 'Uploaded',
    color: 'bg-blue-50 text-blue-700',
    dot: 'bg-blue-500',
    icon: Upload,
  },
  Processing: {
    label: 'Processing',
    color: 'bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
    icon: Cpu,
    pulse: true,
  },
  Verified: {
    label: 'Verified',
    color: 'bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
    icon: CheckCircle2,
  },
};

export default function CVStatusBadge({ status = 'Not Uploaded', size = 'sm' }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG['Not Uploaded'];
  const Icon = config.icon;

  if (size === 'lg') {
    return (
      <span
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold ${config.color}`}
      >
        <Icon className="w-4 h-4" />
        {config.label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${config.color}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${config.dot} ${config.pulse ? 'animate-pulse' : ''}`}
      />
      {config.label}
    </span>
  );
}

/* Stepper variant used on Dashboard */
export function CVStatusStepper({ status = 'Not Uploaded' }) {
  const steps = ['Not Uploaded', 'Uploaded', 'Processing', 'Verified'];
  const currentIndex = steps.indexOf(status);

  const stepIcons = [FileX, Upload, Cpu, CheckCircle2];
  const stepLabels = ['Not Uploaded', 'Uploaded', 'Processing', 'Verified'];

  return (
    <div className="flex items-center w-full">
      {steps.map((step, i) => {
        const isCompleted = i < currentIndex;
        const isCurrent = i === currentIndex;
        const StepIcon = stepIcons[i];

        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center flex-shrink-0">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isCompleted
                    ? 'bg-indigo-600 text-white shadow-md'
                    : isCurrent
                    ? 'bg-white border-2 border-indigo-600 text-indigo-600 shadow-sm'
                    : 'bg-slate-100 text-slate-400 border-2 border-slate-200'
                }`}
              >
                <StepIcon className="w-4 h-4" />
              </div>
              <span
                className={`mt-1.5 text-xs font-medium text-center leading-tight max-w-[60px] ${
                  isCompleted
                    ? 'text-indigo-600'
                    : isCurrent
                    ? 'text-indigo-700 font-semibold'
                    : 'text-slate-400'
                }`}
              >
                {stepLabels[i]}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 mb-5 rounded-full transition-all duration-300 ${
                  i < currentIndex ? 'bg-indigo-600' : 'bg-slate-200'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
