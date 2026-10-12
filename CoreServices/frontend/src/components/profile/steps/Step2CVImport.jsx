import React, { useEffect, useState, useCallback } from "react";
import {
  FileText,
  CheckCircle2,
  Circle,
  RefreshCw,
  AlertCircle,
  Info,
} from "lucide-react";
import { cvService } from "../../../services/cvService.js";
import { CV_STATUS } from "../../../constants/cvStatus.js";
import EntriesEditor from "../EntriesEditor.jsx";
import { errorsUnder } from "../../../validation/validateProfile.js";
import { mapEducation, mapExperience, mapParsedCvToProfile } from "../../../validation/cvImport.js";
import { formatRange } from "../../cvgen/cvModel.js";

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

function ImportPanel({ profile, onChange }) {
  const [parsedCv, setParsedCv] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(false);

  const [selExp, setSelExp] = useState({});
  const [selEdu, setSelEdu] = useState({});
  const [selSkill, setSelSkill] = useState({});
  const [selProj, setSelProj] = useState({});
  const [selCert, setSelCert] = useState({});

  const fetch = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await cvService.getLatestCV();
      // Only completed parses are importable (a processing/failed record may be stale).
      const importable = [CV_STATUS.PARSED, CV_STATUS.VERIFIED].includes(res.status);
      if (res.cvData && importable) {
        setParsedCv({
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
        setSelCert(all(res.cvData.certifications));
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

  // Dates, current flags, certifications and project links come straight from
  // the parse (validation/cvImport.js); older parses fall back to `duration`.
  const applyImport = () => {
    if (!parsedCv) return;
    onChange({
      ...mapParsedCvToProfile(
        parsedCv,
        { experience: selExp, education: selEdu, skills: selSkill, projects: selProj, certifications: selCert },
        profile,
      ),
      cvImportedAt: new Date().toISOString(),
      cvData: {
        parsedData: parsedCv,
        uploadDate: parsedCv.uploadDate || null,
        parsingStatus: parsedCv.parsingStatus || "",
      },
    });
    setImported(true);
  };

  const totalSelected = [selExp, selEdu, selSkill, selProj, selCert].reduce(
    (n, sel) => n + Object.values(sel).filter(Boolean).length,
    0,
  );

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

  if (!parsedCv) {
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
            Select the items you want to import. You can edit them below
            after importing.
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
        items={parsedCv.experience}
        selected={selExp}
        onToggle={setSelExp}
        renderItem={(e) => (
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-800">{e.title}</p>
              <p className="text-xs text-slate-500">
                {e.company}
                {(() => {
                  const m = mapExperience(e);
                  const range = formatRange(m.startDate, m.endDate, m.current) || e.duration;
                  return range ? ` · ${range}` : "";
                })()}
              </p>
            </div>
            {SOURCE_BADGE}
          </div>
        )}
      />

      <ToggleList
        title="Education"
        items={parsedCv.education}
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
                {(() => {
                  const m = mapEducation(e);
                  const range = formatRange(m.startDate, m.endDate, false) || e.year;
                  return range ? ` · ${range}` : "";
                })()}
              </p>
            </div>
            {SOURCE_BADGE}
          </div>
        )}
      />

      <ToggleList
        title="Skills"
        items={parsedCv.skills}
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

      {parsedCv.projects?.length > 0 && (
        <ToggleList
          title="Projects"
          items={parsedCv.projects}
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

      <ToggleList
        title="Certifications"
        items={parsedCv.certifications}
        selected={selCert}
        onToggle={setSelCert}
        renderItem={(c) => (
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-800">{c.name}</p>
              <p className="text-xs text-slate-500">
                {c.issuer || "Issuer missing — add it after importing"}
                {c.date ? ` · ${c.date}` : ""}
              </p>
            </div>
            {SOURCE_BADGE}
          </div>
        )}
      />

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

// Step 2: import from the parsed CV, then review/edit experience and
// education (inline errors use the server's field paths).
export default function Step2CVImport({ profile, onChange, errors = [] }) {
  return (
    <div className="space-y-8">
      <ImportPanel profile={profile} onChange={onChange} />
      <EntriesEditor
        kind="experience"
        items={profile.experience || []}
        errors={errorsUnder(errors, "experience")}
        onChange={(experience) => onChange({ experience })}
      />
      <EntriesEditor
        kind="education"
        items={profile.education || []}
        errors={errorsUnder(errors, "education")}
        onChange={(education) => onChange({ education })}
      />
    </div>
  );
}
