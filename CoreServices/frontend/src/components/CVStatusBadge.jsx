import React from 'react';
import { CheckCircle2, Upload, Cpu, FileX, FileCheck2, AlertTriangle } from 'lucide-react';
import { CV_STATUS, CV_STATUS_LABELS } from '../constants/cvStatus.js';

const STATUS_CONFIG = {
  [CV_STATUS.NOT_UPLOADED]: {
    color: 'bg-slate-100 text-slate-600',
    dot: 'bg-slate-400',
    icon: FileX,
  },
  [CV_STATUS.UPLOADED]: {
    color: 'bg-blue-50 text-blue-700',
    dot: 'bg-blue-500',
    icon: Upload,
  },
  [CV_STATUS.PROCESSING]: {
    color: 'bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
    icon: Cpu,
    pulse: true,
  },
  [CV_STATUS.PARSED]: {
    color: 'bg-sky-50 text-sky-700',
    dot: 'bg-sky-500',
    icon: FileCheck2,
  },
  [CV_STATUS.VERIFIED]: {
    color: 'bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
    icon: CheckCircle2,
  },
  [CV_STATUS.FAILED]: {
    color: 'bg-red-50 text-red-700',
    dot: 'bg-red-500',
    icon: AlertTriangle,
  },
};

export default function CVStatusBadge({ status = CV_STATUS.NOT_UPLOADED, size = 'sm' }) {
  const key = STATUS_CONFIG[status] ? status : CV_STATUS.NOT_UPLOADED;
  const config = STATUS_CONFIG[key];
  const label = CV_STATUS_LABELS[key];
  const Icon = config.icon;

  if (size === 'lg') {
    return (
      <span
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold ${config.color}`}
      >
        <Icon className="w-4 h-4" />
        {label}
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
      {label}
    </span>
  );
}

/* Stepper variant used on Dashboard */
const STEPS = [CV_STATUS.NOT_UPLOADED, CV_STATUS.UPLOADED, CV_STATUS.PROCESSING, CV_STATUS.PARSED, CV_STATUS.VERIFIED];
const STEP_ICONS = [FileX, Upload, Cpu, FileCheck2, CheckCircle2];

export function CVStatusStepper({ status = CV_STATUS.NOT_UPLOADED }) {
  // A failed parse stops at the Processing step, shown in red.
  const failed = status === CV_STATUS.FAILED;
  const currentIndex = failed ? STEPS.indexOf(CV_STATUS.PROCESSING) : Math.max(0, STEPS.indexOf(status));

  return (
    <div className="flex items-center w-full">
      {STEPS.map((step, i) => {
        const isCompleted = i < currentIndex;
        const isCurrent = i === currentIndex;
        const isFailed = failed && isCurrent;
        const StepIcon = isFailed ? AlertTriangle : STEP_ICONS[i];

        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center flex-shrink-0">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isFailed
                    ? 'bg-white border-2 border-red-500 text-red-500 shadow-sm'
                    : isCompleted
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
                  isFailed
                    ? 'text-red-600 font-semibold'
                    : isCompleted
                    ? 'text-indigo-600'
                    : isCurrent
                    ? 'text-indigo-700 font-semibold'
                    : 'text-slate-400'
                }`}
              >
                {isFailed ? CV_STATUS_LABELS.failed : CV_STATUS_LABELS[step]}
              </span>
            </div>
            {i < STEPS.length - 1 && (
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
