import React, { useEffect, useState, useCallback } from "react";
import {
  FileText,
  CheckCircle2,
  Circle,
  RefreshCw,
  AlertCircle,
  Info,
} from "lucide-react";
import { profileService } from "../../../services/profileService.js";

const SOURCE_BADGE = (
  <span className="inline-flex items-center gap-1 text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
    <FileText className="w-3 h-3" /> From CV
  </span>
);

function ToggleList({ title, items, selected, onToggle, renderItem }) {
  if (!items?.length) return null;
  const allSelected = items.every((_, i) => selected[i]);
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-slate-700">{title}</h4>
        <button
          onClick={() => {
            const next = {};
            items.forEach((_, i) => {
              next[i] = !allSelected;
            });
            onToggle(next);
          }}
          className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => onToggle({ ...selected, [i]: !selected[i] })}
            className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
              selected[i]
                ? "border-blue-300 bg-blue-50"
                : "border-slate-100 bg-slate-50 hover:border-slate-200"
            }`}
          >
            {selected[i] ? (
              <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            ) : (
              <Circle className="w-4 h-4 text-slate-300 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">{renderItem(item)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Step2CVImport({ profile, onChange }) {
  const [cvData, setCvData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(false);

  const [selExp, setSelExp] = useState({});
  const [selEdu, setSelEdu] = useState({});
  const [selSkill, setSelSkill] = useState({});
  const [selProj, setSelProj] = useState({});

  const fetch = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await profileService.getCVData();
      if (res.cvData) {
        setCvData({
          ...res.cvData,
          uploadDate: res.uploadDate,
          parsingStatus: res.status,
        });
        // Pre-select all by default
        const all = (arr) =>
          Object.fromEntries((arr || []).map((_, i) => [i, true]));
        setSelExp(all(res.cvData.experience));
        setSelEdu(all(res.cvData.education));
        setSelSkill(all(res.cvData.skills));
        setSelProj(all(res.cvData.projects));
      }
    } catch {
      setError(
        "Could not load CV data. Make sure you have uploaded and parsed a CV.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const applyImport = () => {
    if (!cvData) return;

    const pick = (arr, sel) => (arr || []).filter((_, i) => sel[i]);

    const newExp = pick(cvData.experience, selExp).map((e) => ({
      title: e.title || "",
      company: e.company || "",
      description: e.duration || "",
      startDate: "",
      endDate: "",
      current: false,
      source: "cv",
    }));

    const newEdu = pick(cvData.education, selEdu).map((e) => ({
      institution: e.institution || "",
      degree: e.degree || "",
      field: "",
      startDate: e.year?.split("-")[0] || "",
      endDate: e.year?.split("-")[1]?.trim() || "",
      gpa: "",
      source: "cv",
    }));

    const newCvSkills = pick(cvData.skills, selSkill).map((s) => s.name);

    const newCvProj = pick(cvData.projects || [], selProj).map((p) => ({
      name: p.name || "",
      description: p.description || "",
      technologies: p.technologies || [],
    }));

    // Merge: keep existing manual items, append CV items (avoid exact-title duplicates)
    const existingExpTitles = new Set(
      profile.experience
        .filter((e) => e.source !== "cv")
        .map((e) => e.title?.toLowerCase()),
    );
    const mergedExp = [
      ...profile.experience.filter((e) => e.source !== "cv"),
      ...newExp.filter((e) => !existingExpTitles.has(e.title?.toLowerCase())),
    ];

    const existingEduInst = new Set(
      profile.education
        .filter((e) => e.source !== "cv")
        .map((e) => e.institution?.toLowerCase()),
    );
    const mergedEdu = [
      ...profile.education.filter((e) => e.source !== "cv"),
      ...newEdu.filter(
        (e) => !existingEduInst.has(e.institution?.toLowerCase()),
      ),
    ];

    onChange({
      experience: mergedExp,
      education: mergedEdu,
      skills: { ...profile.skills, cv: newCvSkills },
      projects: { ...profile.projects, cv: newCvProj },
      cvImportedAt: new Date().toISOString(),
      cvData: {
        parsedData: cvData,
        uploadDate: cvData.uploadDate || null,
        parsingStatus: cvData.parsingStatus || "",
      },
    });
    setImported(true);
  };

  const totalSelected =
    Object.values(selExp).filter(Boolean).length +
    Object.values(selEdu).filter(Boolean).length +
    Object.values(selSkill).filter(Boolean).length +
    Object.values(selProj).filter(Boolean).length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Loading CV data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-amber-500" />
        </div>
        <div>
          <p className="font-semibold text-slate-800">No CV data available</p>
          <p className="text-sm text-slate-500 mt-1 max-w-sm">{error}</p>
        </div>
        <button
          onClick={fetch}
          className="btn-secondary w-auto px-5 py-2 text-sm gap-2"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  if (!cvData) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center">
          <Info className="w-6 h-6 text-slate-400" />
        </div>
        <div>
          <p className="font-semibold text-slate-800">No CV data found</p>
          <p className="text-sm text-slate-500 mt-1 max-w-sm">
            Upload and parse a CV first, then come back to auto-fill your
            profile.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
        <FileText className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-800">
            CV data available
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            Select the items you want to import. You can edit them in later
            steps.
          </p>
        </div>
      </div>

      {imported && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <p className="text-sm text-emerald-700 font-medium">
            Imported! You can change selections and re-apply.
          </p>
        </div>
      )}

      <ToggleList
        title="Work Experience"
        items={cvData.experience}
        selected={selExp}
        onToggle={setSelExp}
        renderItem={(e) => (
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-800">{e.title}</p>
              <p className="text-xs text-slate-500">
                {e.company}
                {e.duration ? ` · ${e.duration}` : ""}
              </p>
            </div>
            {SOURCE_BADGE}
          </div>
        )}
      />

      <ToggleList
        title="Education"
        items={cvData.education}
        selected={selEdu}
        onToggle={setSelEdu}
        renderItem={(e) => (
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {e.institution}
              </p>
              <p className="text-xs text-slate-500">
                {e.degree}
                {e.year ? ` · ${e.year}` : ""}
              </p>
            </div>
            {SOURCE_BADGE}
          </div>
        )}
      />

      <ToggleList
        title="Skills"
        items={cvData.skills}
        selected={selSkill}
        onToggle={setSelSkill}
        renderItem={(s) => (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-800">{s.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">
                {Math.round((s.confidence || 1) * 100)}% confidence
              </span>
              {SOURCE_BADGE}
            </div>
          </div>
        )}
      />

      {cvData.projects?.length > 0 && (
        <ToggleList
          title="Projects"
          items={cvData.projects}
          selected={selProj}
          onToggle={setSelProj}
          renderItem={(p) => (
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                {p.description && (
                  <p className="text-xs text-slate-500 line-clamp-2">
                    {p.description}
                  </p>
                )}
                {p.technologies?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {p.technologies.map((t, i) => (
                      <span
                        key={i}
                        className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {SOURCE_BADGE}
            </div>
          )}
        />
      )}

      <button
        onClick={applyImport}
        disabled={totalSelected === 0}
        className="btn-primary mt-2"
      >
        <CheckCircle2 className="w-4 h-4" />
        Import {totalSelected} Selected Item{totalSelected !== 1 ? "s" : ""} to
        Profile
      </button>
    </div>
  );
}
