import React from 'react';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import SkillsSection from './SkillsSection';
import EducationSection from './EducationSection';
import ExperienceSection from './ExperienceSection';

const ParsedSummary = ({ parsedData, isLoading, onEdit, onSave, onDelete }) => {
  if (isLoading) return <LoadingSkeleton />;
  if (!parsedData) return null;

  const hasUncertainItems = (items) => items?.some((item) => item.confidence && item.confidence < 0.8);
  const uncertainSkills = hasUncertainItems(parsedData.skills);
  const uncertainEducation = hasUncertainItems(parsedData.education);
  const uncertainExperience = hasUncertainItems(parsedData.experience);

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md space-y-6">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">CV Parsing Summary</h2>
        <p className="text-gray-600">
          Review and edit the extracted information below. Items marked with{' '}
          <span className="inline-flex items-center gap-1">
            <AlertCircle className="w-4 h-4 text-yellow-600" />
            <span>require your attention</span>
          </span>
        </p>
      </div>

      {(uncertainSkills || uncertainEducation || uncertainExperience) && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-yellow-800">Some items need your review</h3>
            <p className="text-yellow-700 text-sm mt-1">Please check highlighted items for accuracy before saving.</p>
          </div>
        </div>
      )}

      <SkillsSection skills={parsedData.skills || []} onEdit={onEdit} onDelete={onDelete} />
      <EducationSection education={parsedData.education || []} onEdit={onEdit} onDelete={onDelete} />
      <ExperienceSection experience={parsedData.experience || []} onEdit={onEdit} onDelete={onDelete} />

      <div className="mt-8 flex justify-end gap-3 pt-4 border-t">
        <button
          onClick={onSave}
          className="py-2 px-6 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center gap-2"
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
    {[1, 2, 3].map((i) => (
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
