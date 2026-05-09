import React from "react";
import {
  User,
  FileText,
  Briefcase,
  GraduationCap,
  Zap,
  Award,
  Code2,
  Github,
  MapPin,
  Phone,
  Globe,
  Linkedin,
} from "lucide-react";

function Section({
  icon: Icon,
  title,
  children,
  color = "text-indigo-500",
  bg = "bg-indigo-50",
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div
          className={`w-7 h-7 ${bg} rounded-lg flex items-center justify-center`}
        >
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-slate-400 italic">Nothing added.</p>;
}

export default function Step6Review({ profile }) {
  const { personalInfo: pi, skills } = profile;

  const allSkills = [
    ...(skills?.cv || []),
    ...(skills?.extracted || []),
    ...(skills?.manual || []),
  ].filter(
    (s, i, arr) =>
      arr.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i,
  );

  const allProjects = [
    ...(profile.projects?.cv || []).map((p) => ({ ...p, source: "cv" })),
    ...(profile.projects?.github || []).map((p) => ({
      ...p,
      source: "github",
    })),
    ...(profile.projects?.manual || []).map((p) => ({
      ...p,
      source: "manual",
    })),
  ];

  const hasPersonal = pi && Object.values(pi).some((v) => v?.trim());

  return (
    <div className="space-y-4">
      <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
        <p className="text-sm text-emerald-700 font-medium">
          Review your profile below. Click <strong>Save Profile</strong> when
          you're happy — you can always edit later.
        </p>
      </div>

      {/* Personal Info */}
      <Section icon={User} title="Personal Information">
        {!hasPersonal && <Empty />}
        {hasPersonal && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 text-sm">
            {pi?.phone && (
              <span className="flex items-center gap-2 text-slate-600">
                <Phone className="w-4 h-4 text-slate-400" />
                {pi.phone}
              </span>
            )}
            {pi?.location && (
              <span className="flex items-center gap-2 text-slate-600">
                <MapPin className="w-4 h-4 text-slate-400" />
                {pi.location}
              </span>
            )}
            {pi?.website && (
              <a
                href={pi.website}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-indigo-600 hover:underline"
              >
                <Globe className="w-4 h-4" />
                {pi.website}
              </a>
            )}
            {pi?.linkedin && (
              <a
                href={`https://${pi.linkedin}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-indigo-600 hover:underline"
              >
                <Linkedin className="w-4 h-4" />
                {pi.linkedin}
              </a>
            )}
            {pi?.github && (
              <a
                href={`https://${pi.github}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-indigo-600 hover:underline"
              >
                <Github className="w-4 h-4" />
                {pi.github}
              </a>
            )}
          </div>
        )}
      </Section>

      {/* Summary */}
      {profile.summary && (
        <Section
          icon={FileText}
          title="Professional Summary"
          color="text-blue-500"
          bg="bg-blue-50"
        >
          <p className="text-sm text-slate-600 leading-relaxed">
            {profile.summary}
          </p>
        </Section>
      )}

      {profile.cvData && (
        <Section
          icon={FileText}
          title="CV Import"
          color="text-sky-500"
          bg="bg-sky-50"
        >
          <p className="text-sm text-slate-600">
            Parsed CV data imported on{" "}
            {profile.cvData.uploadDate
              ? new Date(profile.cvData.uploadDate).toLocaleDateString()
              : "Unknown date"}
            .
          </p>
          {profile.cvData.parsingStatus && (
            <p className="text-xs text-slate-500 mt-1">
              Status: {profile.cvData.parsingStatus}
            </p>
          )}
        </Section>
      )}

      {/* Experience */}
      <Section
        icon={Briefcase}
        title="Work Experience"
        color="text-amber-500"
        bg="bg-amber-50"
      >
        {!profile.experience?.length && <Empty />}
        <div className="space-y-3">
          {profile.experience?.map((e, i) => (
            <div key={i} className="border-l-2 border-indigo-200 pl-4">
              <p className="text-sm font-semibold text-slate-800">{e.title}</p>
              <p className="text-xs text-slate-500">
                {e.company}
                {(e.startDate || e.endDate) &&
                  ` · ${e.startDate}${e.current ? " – Present" : e.endDate ? ` – ${e.endDate}` : ""}`}
                {e.description && ` · ${e.description}`}
              </p>
              {e.source === "cv" && (
                <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded mt-1 inline-block">
                  From CV
                </span>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Education */}
      <Section
        icon={GraduationCap}
        title="Education"
        color="text-emerald-500"
        bg="bg-emerald-50"
      >
        {!profile.education?.length && <Empty />}
        <div className="space-y-3">
          {profile.education?.map((e, i) => (
            <div key={i} className="border-l-2 border-emerald-200 pl-4">
              <p className="text-sm font-semibold text-slate-800">
                {e.institution}
              </p>
              <p className="text-xs text-slate-500">
                {e.degree}
                {e.field ? ` in ${e.field}` : ""}
                {(e.startDate || e.endDate) &&
                  ` · ${e.startDate}${e.endDate ? ` – ${e.endDate}` : ""}`}
                {e.gpa && ` · GPA: ${e.gpa}`}
              </p>
              {e.source === "cv" && (
                <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded mt-1 inline-block">
                  From CV
                </span>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Skills */}
      <Section
        icon={Zap}
        title={`Skills (${allSkills.length})`}
        color="text-violet-500"
        bg="bg-violet-50"
      >
        {!allSkills.length && <Empty />}
        <div className="flex flex-wrap gap-2">
          {allSkills.map((s, i) => (
            <span
              key={i}
              className="bg-slate-100 text-slate-700 text-xs font-medium px-2.5 py-1 rounded-full"
            >
              {s}
            </span>
          ))}
        </div>
      </Section>

      {/* Projects */}
      <Section
        icon={Code2}
        title={`Projects (${allProjects.length})`}
        color="text-rose-500"
        bg="bg-rose-50"
      >
        {!allProjects.length && <Empty />}
        <div className="space-y-3">
          {allProjects.map((p, i) => {
            const techs = p.technologies || p.languages || [];
            return (
              <div key={i} className="border-l-2 border-rose-200 pl-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-800">
                    {p.name}
                  </p>
                  <span
                    className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      p.source === "cv"
                        ? "bg-blue-100 text-blue-600"
                        : p.source === "github"
                          ? "bg-purple-100 text-purple-600"
                          : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {p.source === "cv"
                      ? "From CV"
                      : p.source === "github"
                        ? "GitHub"
                        : "Manual"}
                  </span>
                </div>
                {p.description && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {p.description}
                  </p>
                )}
                {techs.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {techs.map((t, j) => (
                      <span
                        key={j}
                        className="text-xs bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Certifications */}
      {profile.certifications?.length > 0 && (
        <Section
          icon={Award}
          title="Certifications"
          color="text-orange-500"
          bg="bg-orange-50"
        >
          <div className="space-y-2">
            {profile.certifications.map((c, i) => (
              <div key={i} className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {c.name}
                  </p>
                  {c.issuer && (
                    <p className="text-xs text-slate-500">
                      {c.issuer}
                      {c.date ? ` · ${c.date}` : ""}
                    </p>
                  )}
                </div>
                {c.url && (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-600 hover:underline flex-shrink-0"
                  >
                    View
                  </a>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
