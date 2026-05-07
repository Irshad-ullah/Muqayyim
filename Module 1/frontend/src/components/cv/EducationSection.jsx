import React, { useState } from 'react';
import { X, Plus, AlertCircle, Edit2 } from 'lucide-react';

const EducationSection = ({ education = [], onEdit, onDelete }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newEducation, setNewEducation] = useState({ degree: '', institution: '', year: new Date().getFullYear().toString() });
  const [editValues, setEditValues] = useState({});

  const handleAddEducation = () => {
    if (newEducation.degree.trim() && newEducation.institution.trim()) {
      onEdit?.({ type: 'education_add', data: { ...newEducation, confidence: 1.0 } });
      setNewEducation({ degree: '', institution: '', year: new Date().getFullYear().toString() });
      setIsAdding(false);
    }
  };

  const handleEditEducation = (index) => {
    onEdit?.({ type: 'education_update', index, data: { ...editValues, confidence: education[index]?.confidence } });
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
    <div className="border rounded-lg p-6 bg-gradient-to-br from-purple-50 to-white">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-gray-800">Education</h3>
        <button onClick={() => setIsAdding(true)} className="flex items-center gap-2 px-3 py-1 text-purple-600 hover:bg-purple-50 rounded transition-colors" disabled={isAdding}>
          <Plus className="w-4 h-4" />
          Add Education
        </button>
      </div>

      {isAdding && (
        <div className="mb-4 p-4 bg-white border border-purple-200 rounded-lg space-y-3">
          <input type="text" value={newEducation.degree} onChange={(e) => setNewEducation({ ...newEducation, degree: e.target.value })} placeholder="Degree (e.g., B.S. Computer Science)" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
          <input type="text" value={newEducation.institution} onChange={(e) => setNewEducation({ ...newEducation, institution: e.target.value })} placeholder="Institution (e.g., MIT)" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
          <input type="number" value={newEducation.year} onChange={(e) => setNewEducation({ ...newEducation, year: e.target.value })} placeholder="Year" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
          <div className="flex gap-2">
            <button onClick={handleAddEducation} className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">Add</button>
            <button onClick={() => setIsAdding(false)} className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {education && education.length > 0 ? (
          education.map((edu, index) => (
            <div key={index} className={`border rounded-lg p-4 ${edu.confidence && edu.confidence < 0.8 ? 'bg-yellow-50 border-yellow-300' : 'bg-white border-gray-200'}`}>
              {editingId === index ? (
                <div className="space-y-3">
                  <input type="text" value={editValues.degree || edu.degree} onChange={(e) => setEditValues({ ...editValues, degree: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  <input type="text" value={editValues.institution || edu.institution} onChange={(e) => setEditValues({ ...editValues, institution: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  <input type="number" value={editValues.year || edu.year} onChange={(e) => setEditValues({ ...editValues, year: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  <div className="flex gap-2">
                    <button onClick={() => handleEditEducation(index)} className="flex-1 px-4 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">Save</button>
                    <button onClick={() => setEditingId(null)} className="flex-1 px-4 py-1 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {edu.confidence && edu.confidence < 0.8 && <AlertCircle className="w-4 h-4 text-yellow-600" />}
                      <h4 className="font-bold text-gray-800">{edu.degree}</h4>
                      {edu.confidence && (
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${getConfidenceBadgeColor(edu.confidence)}`}>
                          {getConfidenceLabel(edu.confidence)}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-700">{edu.institution}</p>
                    <p className="text-sm text-gray-600">{edu.year}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setEditingId(index); setEditValues(edu); }} className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors" title="Edit"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => onDelete?.({ type: 'education', index })} className="p-2 text-red-600 hover:bg-red-100 rounded transition-colors" title="Delete"><X className="w-4 h-4" /></button>
                  </div>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="text-gray-500 italic">No education extracted. Add one manually.</p>
        )}
      </div>
      <p className="text-sm text-gray-500 mt-4">Items with low confidence are highlighted for your review.</p>
    </div>
  );
};

export default EducationSection;
