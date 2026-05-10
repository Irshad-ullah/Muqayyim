import React, { useState } from "react";
import { X, Plus, Edit2, Check } from "lucide-react";

const ProjectsSection = ({ projects = [], onEdit, onDelete }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [formValues, setFormValues] = useState({
    name: "",
    description: "",
    technologies: "",
  });

  const startEdit = (index, project) => {
    setEditingIndex(index);
    setFormValues({
      name: project.name || "",
      description: project.description || "",
      technologies: (project.technologies || []).join(", "),
    });
  };

  const finishEdit = () => {
    if (!formValues.name.trim()) return;
    onEdit?.({
      type: "project_update",
      index: editingIndex,
      data: {
        name: formValues.name.trim(),
        description: formValues.description.trim(),
        technologies: formValues.technologies
          .split(",")
          .map((tech) => tech.trim())
          .filter(Boolean),
      },
    });
    setEditingIndex(null);
    setFormValues({ name: "", description: "", technologies: "" });
  };

  const handleAdd = () => {
    if (!formValues.name.trim()) return;
    onEdit?.({
      type: "project_add",
      data: {
        name: formValues.name.trim(),
        description: formValues.description.trim(),
        technologies: formValues.technologies
          .split(",")
          .map((tech) => tech.trim())
          .filter(Boolean),
      },
    });
    setIsAdding(false);
    setFormValues({ name: "", description: "", technologies: "" });
  };

  const renderForm = () => (
    <div className="mb-4 p-4 bg-white border border-slate-200 rounded-lg space-y-3">
      <input
        type="text"
        value={formValues.name}
        onChange={(e) => setFormValues({ ...formValues, name: e.target.value })}
        placeholder="Project title"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
      />
      <textarea
        value={formValues.description}
        onChange={(e) =>
          setFormValues({ ...formValues, description: e.target.value })
        }
        placeholder="Description"
        rows={3}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
      />
      <input
        type="text"
        value={formValues.technologies}
        onChange={(e) =>
          setFormValues({ ...formValues, technologies: e.target.value })
        }
        placeholder="Technologies (comma separated)"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
      />
      <div className="flex gap-2">
        <button
          onClick={isAdding ? handleAdd : finishEdit}
          className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors"
        >
          <Check className="w-4 h-4 mr-2" />
          {isAdding ? "Add Project" : "Save"}
        </button>
        <button
          onClick={() => {
            setIsAdding(false);
            setEditingIndex(null);
            setFormValues({ name: "", description: "", technologies: "" });
          }}
          className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="border rounded-lg p-6 bg-gradient-to-br from-slate-50 to-white">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-gray-800">Projects</h3>
        <button
          onClick={() => {
            setIsAdding(true);
            setEditingIndex(null);
            setFormValues({ name: "", description: "", technologies: "" });
          }}
          className="flex items-center gap-2 px-3 py-1 text-slate-700 hover:bg-slate-100 rounded transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Project
        </button>
      </div>

      {isAdding && renderForm()}

      <div className="space-y-3">
        {projects && projects.length > 0 ? (
          projects.map((project, index) => (
            <div
              key={index}
              className="border rounded-lg p-4 bg-white shadow-sm"
            >
              {editingIndex === index ? (
                <div className="space-y-3">{renderForm()}</div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-gray-800">
                        {project.name}
                      </h4>
                      {project.description ? (
                        <p className="text-gray-600 mt-2 whitespace-pre-wrap">
                          {project.description}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 italic">
                          No description available.
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => startEdit(index, project)}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                        title="Edit project"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDelete?.({ type: "project", index })}
                        className="p-2 text-red-600 hover:bg-red-100 rounded transition-colors"
                        title="Delete project"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {project.technologies && project.technologies.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {project.technologies.map((tech, techIndex) => (
                        <span
                          key={techIndex}
                          className="text-xs font-medium px-2 py-1 bg-slate-100 text-slate-800 rounded-full"
                        >
                          {tech}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        ) : (
          <p className="text-gray-500 italic">
            No projects extracted yet. Add one manually to include it in your
            profile.
          </p>
        )}
      </div>

      <p className="text-sm text-gray-500 mt-4">
        💡 You can add, edit, or remove projects before saving.
      </p>
    </div>
  );
};

export default ProjectsSection;
