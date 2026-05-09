import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  User,
  FileText,
  Github,
  Zap,
  Code2,
  CheckCircle,
  ArrowLeft,
  ArrowRight,
  Save,
  ChevronLeft,
} from "lucide-react";
import Navbar from "../components/Navbar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { profileService } from "../services/profileService.js";
import toast from "react-hot-toast";

import Step1BasicInfo from "../components/profile/steps/Step1BasicInfo.jsx";
import Step2CVImport from "../components/profile/steps/Step2CVImport.jsx";
import Step3GitHub from "../components/profile/steps/Step3GitHub.jsx";
import Step4Skills from "../components/profile/steps/Step4Skills.jsx";
import Step5Projects from "../components/profile/steps/Step5Projects.jsx";
import Step6Review from "../components/profile/steps/Step6Review.jsx";

// ── Wizard step definitions ───────────────────────────────────────────────────
const STEPS = [
  {
    id: "basic",
    label: "Basic Info",
    icon: User,
    hint: "Contact details and summary",
  },
  {
    id: "cv",
    label: "CV Import",
    icon: FileText,
    hint: "Auto-fill from your parsed CV",
  },
  {
    id: "github",
    label: "GitHub",
    icon: Github,
    hint: "Import repos and extract skills",
  },
  {
    id: "skills",
    label: "Skills",
    icon: Zap,
    hint: "Review and merge all skills",
  },
  {
    id: "projects",
    label: "Projects",
    icon: Code2,
    hint: "Combine projects from all sources",
  },
  {
    id: "review",
    label: "Review",
    icon: CheckCircle,
    hint: "Final review before saving",
  },
];

// ── Empty profile shape ───────────────────────────────────────────────────────
const EMPTY = {
  personalInfo: {
    phone: "",
    location: "",
    website: "",
    linkedin: "",
    github: "",
  },
  summary: "",
  experience: [],
  education: [],
  skills: { manual: [], cv: [], extracted: [] },
  certifications: [],
  projects: { manual: [], github: [], cv: [], selected: [] },
  githubData: { username: "", repos: [], extractedSkills: [] },
  cvData: null,
  cvImportedAt: null,
};

// ── StepIndicator ─────────────────────────────────────────────────────────────
function StepIndicator({ current }) {
  return (
    <div className="flex items-center gap-0 mb-8 overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={step.id}>
            <div className="flex flex-col items-center flex-shrink-0">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 ${
                  done
                    ? "bg-indigo-600 text-white"
                    : active
                      ? "bg-indigo-600 text-white ring-4 ring-indigo-100"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {done ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </div>
              <span
                className={`text-xs mt-1.5 font-medium text-center leading-tight max-w-[64px] ${
                  active
                    ? "text-indigo-700"
                    : done
                      ? "text-slate-600"
                      : "text-slate-400"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 mb-5 rounded-full transition-colors ${
                  i < current ? "bg-indigo-600" : "bg-slate-200"
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────
export default function ProfileBuilderPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(EMPTY);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load existing profile on mount
  useEffect(() => {
    profileService
      .getProfile()
      .then(({ profile: p }) => {
        if (p) {
          setProfile({
            personalInfo: p.personalInfo ?? EMPTY.personalInfo,
            summary: p.summary ?? "",
            experience: p.experience ?? [],
            education: p.education ?? [],
            skills: {
              manual: p.skills?.manual ?? [],
              cv: p.skills?.cv ?? [],
              extracted: p.skills?.extracted ?? [],
            },
            certifications: p.certifications ?? [],
            projects: {
              manual: p.projects?.manual ?? [],
              github: p.projects?.github ?? [],
              cv: p.projects?.cv ?? [],
              selected: p.projects?.selected ?? [],
            },
            githubData: p.githubData ?? EMPTY.githubData,
            cvData: p.cvData ?? null,
            cvImportedAt: p.cvImportedAt ?? null,
          });
        }
      })
      .catch(() => toast.error("Could not load existing profile"))
      .finally(() => setLoading(false));
  }, []);

  // Partial-update helper — each step calls onChange({field: value})
  const handleChange = (updates) => setProfile((p) => ({ ...p, ...updates }));

  const buildProjectSelection = () => {
    const cvProjects = (profile.projects?.cv || []).map((p) => ({
      source: "cv",
      name: p.name,
      description: p.description || "",
      url: "",
      technologies: p.technologies || [],
    }));

    const githubProjects = (profile.projects?.github || []).map((p) => ({
      source: "github",
      name: p.name,
      description: p.description || "",
      url: p.url || "",
      technologies: [...(p.languages || []), ...(p.topics || [])].filter(
        Boolean,
      ),
    }));

    const manualProjects = (profile.projects?.manual || []).map((p) => ({
      source: "manual",
      name: p.name,
      description: p.description || "",
      url: p.url || "",
      technologies: p.technologies || [],
    }));

    const seen = new Set();
    return [...cvProjects, ...githubProjects, ...manualProjects].filter(
      (project) => {
        const key = `${project.source}:${project.name?.trim().toLowerCase()}`;
        if (!project.name?.trim() || seen.has(key)) return false;
        seen.add(key);
        return true;
      },
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const selectedProjects = buildProjectSelection();
      await profileService.saveProfile({
        ...profile,
        projects: {
          ...profile.projects,
          selected: selectedProjects,
        },
      });
      toast.success("Profile saved successfully!");
    } catch {
      toast.error("Failed to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const goNext = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  // ── Render step content ─────────────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {
      case 0:
        return <Step1BasicInfo profile={profile} onChange={handleChange} />;
      case 1:
        return <Step2CVImport profile={profile} onChange={handleChange} />;
      case 2:
        return <Step3GitHub profile={profile} onChange={handleChange} />;
      case 3:
        return <Step4Skills profile={profile} onChange={handleChange} />;
      case 4:
        return <Step5Projects profile={profile} onChange={handleChange} />;
      case 5:
        return <Step6Review profile={profile} />;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <main
          className="pt-16 flex items-center justify-center"
          style={{ minHeight: "calc(100vh - 4rem)" }}
        >
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </main>
      </div>
    );
  }

  const currentStepMeta = STEPS[step];

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </Link>
              <div className="w-px h-5 bg-slate-200" />
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  Profile Builder
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Step {step + 1} of {STEPS.length} · {user?.name}
                </p>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary w-auto px-5 py-2.5 text-sm"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saving ? "Saving…" : "Save Profile"}
            </button>
          </div>

          {/* Step indicator */}
          <StepIndicator current={step} />

          {/* Step card */}
          <div className="card p-6 mb-6">
            {/* Step title */}
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
              <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <currentStepMeta.icon className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {currentStepMeta.label}
                </h2>
                <p className="text-xs text-slate-500">{currentStepMeta.hint}</p>
              </div>
            </div>

            {/* Content */}
            {renderStep()}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={goBack}
              disabled={step === 0}
              className="btn-secondary w-auto px-5 py-2.5 text-sm disabled:opacity-40"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>

            <span className="text-xs text-slate-400">
              {step + 1} / {STEPS.length}
            </span>

            {step < STEPS.length - 1 ? (
              <button
                onClick={goNext}
                className="btn-primary w-auto px-5 py-2.5 text-sm"
              >
                Next <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary w-auto px-5 py-2.5 text-sm bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500"
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {saving ? "Saving…" : "Save Profile"}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
