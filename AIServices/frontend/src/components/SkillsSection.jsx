import React, { useState } from 'react';
import { X, Plus, AlertCircle, Edit2 } from 'lucide-react';

/**
 * SkillsSection Component
 * - Display extracted skills with confidence indicators
 * - Allow adding, editing, and deleting skills
 * - Highlight uncertain skills
 */
const SkillsSection = ({ skills = [], onEdit, onDelete }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newSkill, setNewSkill] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  const handleAddSkill = () => {
    if (newSkill.trim()) {
      onEdit?.({
        type: 'skill_add',
        data: { name: newSkill.trim(), confidence: 1.0 },
      });
      setNewSkill('');
      setIsAdding(false);
    }
  };

  const handleEditSkill = (skill) => {
    onEdit?.({
      type: 'skill_update',
      oldName: skill.name,
      data: { name: editValue.trim(), confidence: skill.confidence },
    });
    setEditingId(null);
    setEditValue('');
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
    <div className="border rounded-lg p-6 bg-gradient-to-br from-blue-50 to-white">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-gray-800">Skills</h3>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-3 py-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
          disabled={isAdding}
        >
          <Plus className="w-4 h-4" />
          Add Skill
        </button>
      </div>

      {/* Add New Skill Form */}
      {isAdding && (
        <div className="mb-4 p-4 bg-white border border-blue-200 rounded-lg">
          <div className="flex gap-2">
            <input
              type="text"
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
              placeholder="Enter skill name..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddSkill();
                if (e.key === 'Escape') setIsAdding(false);
              }}
            />
            <button
              onClick={handleAddSkill}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => setIsAdding(false)}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Skills List */}
      <div className="flex flex-wrap gap-3">
        {skills && skills.length > 0 ? (
          skills.map((skill, index) => (
            <div
              key={index}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border ${
                skill.confidence && skill.confidence < 0.8
                  ? 'bg-yellow-50 border-yellow-300'
                  : 'bg-white border-gray-300'
              }`}
            >
              {editingId === index ? (
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEditSkill(skill);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    {skill.confidence && skill.confidence < 0.8 && (
                      <AlertCircle className="w-4 h-4 text-yellow-600" />
                    )}
                    <span className="font-medium text-gray-800">{skill.name}</span>
                  </div>
                  {skill.confidence && (
                    <span
                      className={`text-xs font-semibold px-2 py-1 rounded-full border ${getConfidenceBadgeColor(
                        skill.confidence
                      )}`}
                    >
                      {getConfidenceLabel(skill.confidence)}
                    </span>
                  )}
                </>
              )}

              <div className="flex items-center gap-1 ml-auto">
                {editingId === index ? (
                  <>
                    <button
                      onClick={() => handleEditSkill(skill)}
                      className="p-1 text-green-600 hover:bg-green-100 rounded transition-colors"
                      title="Save"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      title="Cancel"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditingId(index);
                        setEditValue(skill.name);
                      }}
                      className="p-1 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDelete?.({ type: 'skill', name: skill.name })}
                      className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors"
                      title="Delete"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="text-gray-500 italic">No skills extracted. Add one manually.</p>
        )}
      </div>

      {/* Helper Text */}
      <p className="text-sm text-gray-500 mt-4">
        💡 You can add, edit, or remove skills. Items with low confidence are highlighted.
      </p>
    </div>
  );
};

export default SkillsSection;
