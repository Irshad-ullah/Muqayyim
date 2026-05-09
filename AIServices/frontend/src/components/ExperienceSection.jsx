import React, { useState } from 'react';
import { X, Plus, AlertCircle, Edit2 } from 'lucide-react';

/**
 * ExperienceSection Component
 * - Display extracted experience with confidence indicators
 * - Allow adding, editing, and deleting experience entries
 * - Show job title, company, duration
 */
const ExperienceSection = ({ experience = [], onEdit, onDelete }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newExperience, setNewExperience] = useState({
    title: '',
    company: '',
    duration: '',
  });
  const [editValues, setEditValues] = useState({});

  const handleAddExperience = () => {
    if (
      newExperience.title.trim() &&
      newExperience.company.trim()
    ) {
      onEdit?.({
        type: 'experience_add',
        data: {
          ...newExperience,
          confidence: 1.0,
        },
      });
      setNewExperience({
        title: '',
        company: '',
        duration: '',
      });
      setIsAdding(false);
    }
  };

  const handleEditExperience = (index) => {
    onEdit?.({
      type: 'experience_update',
      index,
      data: {
        ...editValues,
        confidence: experience[index]?.confidence,
      },
    });
    setEditingId(null);
    setEditValues({});
  };

  const getConfidenceBadgeColor = (confidence) => {
    if (confidence >= 0.9) return 'bg-green-100 text-green-800 border-green-200';
    if (confidence >= 0.8) return 'bg-blue-100 text-blue-800 border-blue-200';
    return 'bg-yellow-100 text-yellow-800 border-yellow-200';
  };

  const getConfidenceLabel = (confidence) => {
    if (confidence >= 0.9) return 'High';
    if (confidence >= 0.8) return 'Medium';
    return 'Low';
  };

  return (
    <div className="border rounded-lg p-6 bg-gradient-to-br from-green-50 to-white">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-gray-800">Experience</h3>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-3 py-1 text-green-600 hover:bg-green-50 rounded transition-colors"
          disabled={isAdding}
        >
          <Plus className="w-4 h-4" />
          Add Experience
        </button>
      </div>

      {/* Add New Experience Form */}
      {isAdding && (
        <div className="mb-4 p-4 bg-white border border-green-200 rounded-lg space-y-3">
          <input
            type="text"
            value={newExperience.title}
            onChange={(e) =>
              setNewExperience({ ...newExperience, title: e.target.value })
            }
            placeholder="Job Title (e.g., Senior Software Engineer)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            type="text"
            value={newExperience.company}
            onChange={(e) =>
              setNewExperience({ ...newExperience, company: e.target.value })
            }
            placeholder="Company (e.g., Google)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            type="text"
            value={newExperience.duration}
            onChange={(e) =>
              setNewExperience({ ...newExperience, duration: e.target.value })
            }
            placeholder="Duration (e.g., Jan 2020 - Dec 2023)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAddExperience}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => setIsAdding(false)}
              className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Experience List */}
      <div className="space-y-3">
        {experience && experience.length > 0 ? (
          experience.map((exp, index) => (
            <div
              key={index}
              className={`border rounded-lg p-4 ${
                exp.confidence && exp.confidence < 0.8
                  ? 'bg-yellow-50 border-yellow-300'
                  : 'bg-white border-gray-200'
              }`}
            >
              {editingId === index ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editValues.title || exp.title}
                    onChange={(e) =>
                      setEditValues({ ...editValues, title: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <input
                    type="text"
                    value={editValues.company || exp.company}
                    onChange={(e) =>
                      setEditValues({ ...editValues, company: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <input
                    type="text"
                    value={editValues.duration || exp.duration}
                    onChange={(e) =>
                      setEditValues({ ...editValues, duration: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditExperience(index)}
                      className="flex-1 px-4 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="flex-1 px-4 py-1 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {exp.confidence && exp.confidence < 0.8 && (
                        <AlertCircle className="w-4 h-4 text-yellow-600" />
                      )}
                      <h4 className="font-bold text-gray-800">{exp.title}</h4>
                      {exp.confidence && (
                        <span
                          className={`text-xs font-semibold px-2 py-1 rounded-full border ${getConfidenceBadgeColor(
                            exp.confidence
                          )}`}
                        >
                          {getConfidenceLabel(exp.confidence)}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-700">{exp.company}</p>
                    {exp.duration && (
                      <p className="text-sm text-gray-600">{exp.duration}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingId(index);
                        setEditValues(exp);
                      }}
                      className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDelete?.({ type: 'experience', index })}
                      className="p-2 text-red-600 hover:bg-red-100 rounded transition-colors"
                      title="Delete"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="text-gray-500 italic">No experience extracted. Add one manually.</p>
        )}
      </div>

      {/* Helper Text */}
      <p className="text-sm text-gray-500 mt-4">
        💡 You can add, edit, or remove experience entries. Items with low confidence are highlighted.
      </p>
    </div>
  );
};

export default ExperienceSection;
