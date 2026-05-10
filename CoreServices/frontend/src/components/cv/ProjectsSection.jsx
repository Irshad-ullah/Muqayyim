import React, { useState } from 'react';
import { X, Plus, Edit2, Code2 } from 'lucide-react';

const TAG_COLORS = [
  'bg-blue-100 text-blue-800 border-blue-200',
  'bg-green-100 text-green-800 border-green-200',
  'bg-purple-100 text-purple-800 border-purple-200',
  'bg-orange-100 text-orange-800 border-orange-200',
  'bg-pink-100 text-pink-800 border-pink-200',
  'bg-teal-100 text-teal-800 border-teal-200',
];

const TechTags = ({ technologies = [] }) =>
  technologies.length === 0 ? null : (
    <div className="flex flex-wrap gap-1 mt-2">
      {technologies.map((tech, i) => (
        <span
          key={i}
          className={`text-xs font-medium px-2 py-0.5 rounded-full border ${TAG_COLORS[i % TAG_COLORS.length]}`}
        >
          {tech}
        </span>
      ))}
    </div>
  );

const EMPTY = { name: '', description: '', technologies: [] };

const parseTechs = (str) =>
  str.split(',').map((t) => t.trim()).filter(Boolean);

const ProjectsSection = ({ projects = [], onEdit, onDelete }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newProject, setNewProject] = useState(EMPTY);
  const [newTechStr, setNewTechStr] = useState('');
  const [editValues, setEditValues] = useState({});
  const [editTechStr, setEditTechStr] = useState('');

  const handleAdd = () => {
    const name = newProject.name.trim();
    if (!name) return;
    onEdit?.({
      type: 'project_add',
      data: { ...newProject, name, technologies: parseTechs(newTechStr) },
    });
    setNewProject(EMPTY);
    setNewTechStr('');
    setIsAdding(false);
  };

  const startEdit = (index) => {
    const p = projects[index];
    setEditingId(index);
    setEditValues({ name: p.name, description: p.description || '' });
    setEditTechStr((p.technologies || []).join(', '));
  };

  const handleSaveEdit = (index) => {
    if (!editValues.name?.trim()) return;
    onEdit?.({
      type: 'project_update',
      index,
      data: { ...editValues, name: editValues.name.trim(), technologies: parseTechs(editTechStr) },
    });
    setEditingId(null);
    setEditValues({});
    setEditTechStr('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
    setEditTechStr('');
  };

  return (
    <div className="border rounded-lg p-6 bg-gradient-to-br from-purple-50 to-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Code2 className="w-5 h-5 text-purple-600" />
          <h3 className="text-xl font-bold text-gray-800">Projects</h3>
          <span className="text-sm text-gray-500 font-normal">
            ({projects.length} extracted)
          </span>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          disabled={isAdding}
          className="flex items-center gap-2 px-3 py-1 text-purple-600 hover:bg-purple-50 rounded transition-colors disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          Add Project
        </button>
      </div>

      {/* Add form */}
      {isAdding && (
        <div className="mb-4 p-4 bg-white border border-purple-200 rounded-lg space-y-3">
          <input
            autoFocus
            type="text"
            value={newProject.name}
            onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
            placeholder="Project Name *"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setIsAdding(false); }}
          />
          <textarea
            value={newProject.description}
            onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
            placeholder="Description (optional)"
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
          />
          <input
            type="text"
            value={newTechStr}
            onChange={(e) => setNewTechStr(e.target.value)}
            placeholder="Technologies (comma-separated, e.g. React, Node.js, MongoDB)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          {newTechStr && (
            <div className="flex flex-wrap gap-1">
              {parseTechs(newTechStr).map((t, i) => (
                <span key={i} className={`text-xs font-medium px-2 py-0.5 rounded-full border ${TAG_COLORS[i % TAG_COLORS.length]}`}>{t}</span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!newProject.name.trim()}
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => { setIsAdding(false); setNewProject(EMPTY); setNewTechStr(''); }}
              className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Project cards */}
      <div className="space-y-3">
        {projects.length > 0 ? (
          projects.map((project, index) => (
            <div key={index} className="border rounded-lg p-4 bg-white border-gray-200">
              {editingId === index ? (
                /* Edit form */
                <div className="space-y-3">
                  <input
                    autoFocus
                    type="text"
                    value={editValues.name}
                    onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                    placeholder="Project Name *"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <textarea
                    value={editValues.description}
                    onChange={(e) => setEditValues({ ...editValues, description: e.target.value })}
                    placeholder="Description"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                  />
                  <input
                    type="text"
                    value={editTechStr}
                    onChange={(e) => setEditTechStr(e.target.value)}
                    placeholder="Technologies (comma-separated)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  {editTechStr && (
                    <div className="flex flex-wrap gap-1">
                      {parseTechs(editTechStr).map((t, i) => (
                        <span key={i} className={`text-xs font-medium px-2 py-0.5 rounded-full border ${TAG_COLORS[i % TAG_COLORS.length]}`}>{t}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(index)}
                      disabled={!editValues.name?.trim()}
                      className="flex-1 px-4 py-1 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="flex-1 px-4 py-1 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* Display row */
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-gray-800">{project.name}</h4>
                    {project.description && (
                      <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{project.description}</p>
                    )}
                    <TechTags technologies={project.technologies} />
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => startEdit(index)}
                      className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDelete?.({ type: 'project', index })}
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
          <p className="text-gray-500 italic">No projects extracted. Add one manually.</p>
        )}
      </div>

      <p className="text-sm text-gray-500 mt-4">
        Technology tags are auto-detected from project names and descriptions.
      </p>
    </div>
  );
};

export default ProjectsSection;
