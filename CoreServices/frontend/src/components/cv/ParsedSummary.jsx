import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import SkillsSection from './SkillsSection';
import ProjectsSection from './ProjectsSection';
import ReviewEntries from './ReviewEntries.jsx';
import { validateParsedCv } from '../../validation/cvImport.js';
import { describeField } from '../../validation/validateProfile.js';

// Review step (Module 2 FE-4/FE-5). "Confirm & Save" stays disabled until the
// data passes the same rules the server applies on verify — required fields,
// dates, links — so a verified CV can always be imported into the profile.
const ParsedSummary = ({ parsedData, isLoading, onEdit, onSave, onDelete }) => {
  const errors = useMemo(() => (parsedData ? validateParsedCv(parsedData) : []), [parsedData]);
  if (isLoading) return <LoadingSkeleton />;
  if (!parsedData) return null;

  const sections = ['experience', 'education', 'certifications', 'projects'];
  const flaggedCount = sections.reduce(
    (n, key) => n + (parsedData[key] || []).filter((e) => e.needsReview?.length).length,
    0,
  );
  const replace = (key) => (items) => onEdit?.({ type: 'section_replace', key, items });
  const blocked = errors.length > 0;

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md space-y-6">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">CV Parsing Summary</h2>
        <p className="text-gray-600">
          Review and edit the extracted information. Fields outlined in{' '}
          <span className="font-semibold text-amber-700">amber</span> could not be read reliably from your CV.
        </p>
        <p className="text-sm text-gray-500 mt-1" data-testid="parsed-counts">
          Found {(parsedData.skills || []).length} skills, {(parsedData.experience || []).length} experience,{' '}
          {(parsedData.education || []).length} education, {(parsedData.certifications || []).length} certifications and{' '}
          {(parsedData.projects || []).length} projects.
        </p>
      </div>

      {flaggedCount > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-amber-800">{flaggedCount} item{flaggedCount === 1 ? '' : 's'} need your review</h3>
            <p className="text-amber-700 text-sm mt-1">Fill in the highlighted fields before saving.</p>
          </div>
        </div>
      )}

      <SkillsSection skills={parsedData.skills || []} onEdit={onEdit} onDelete={onDelete} />
      <ReviewEntries kind="experience" items={parsedData.experience || []} errors={errors} onChange={replace('experience')} />
      <ReviewEntries kind="education" items={parsedData.education || []} errors={errors} onChange={replace('education')} />
      <ReviewEntries kind="certifications" items={parsedData.certifications || []} errors={errors} onChange={replace('certifications')} />
      <ProjectsSection projects={parsedData.projects || []} onEdit={onEdit} onDelete={onDelete} />

      {blocked && (
        <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700" role="status" data-testid="verify-blockers">
          <p className="font-semibold">Before saving, fix:</p>
          <ul className="list-disc ml-5 mt-1 space-y-0.5">
            {errors.slice(0, 8).map((e) => (
              <li key={e.field + e.message}>
                {describeField(e.field)}: {e.message}
              </li>
            ))}
            {errors.length > 8 && <li>…and {errors.length - 8} more</li>}
          </ul>
        </div>
      )}

      <div className="mt-8 flex justify-end gap-3 pt-4 border-t">
        <button
          onClick={onSave}
          disabled={blocked}
          title={blocked ? 'Fill in the highlighted fields first' : undefined}
          className="py-2 px-6 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CheckCircle2 className="w-5 h-5" />
          Confirm & Save
        </button>
      </div>
    </div>
  );
};

const LoadingSkeleton = () => (
  <div className="w-full max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md space-y-6">
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-6 h-6 text-blue-600 animate-spin" />
        <h2 className="text-2xl font-bold text-gray-800">Parsing your CV...</h2>
      </div>
      <p className="text-gray-600">Our AI is analyzing your CV. This should take 10–30 seconds.</p>
    </div>
    {[1, 2, 3, 4].map((i) => (
      <div key={i} className="space-y-4">
        <div className="h-6 bg-gray-200 rounded w-1/4 animate-pulse" />
        <div className="space-y-3">
          {[1, 2].map((j) => (
            <div key={j} className="p-4 bg-gray-50 rounded-lg space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse" />
              <div className="h-3 bg-gray-200 rounded w-1/2 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

export default ParsedSummary;
