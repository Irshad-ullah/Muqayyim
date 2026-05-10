import React from "react";
import { Phone, MapPin, Globe, Linkedin, Github } from "lucide-react";

export default function PersonalInfoForm({ data, onChange }) {
  const update = (field, value) => onChange({ ...data, [field]: value });

  const fields = [
    {
      key: "phone",
      icon: Phone,
      type: "tel",
      placeholder: "+92 0000000",
      label: "Phone",
    },
    {
      key: "location",
      icon: MapPin,
      type: "text",
      placeholder: "City, Country",
      label: "Location",
    },
    {
      key: "website",
      icon: Globe,
      type: "url",
      placeholder: "https://yourwebsite.com",
      label: "Website",
    },
    {
      key: "linkedin",
      icon: Linkedin,
      type: "text",
      placeholder: "linkedin.com/in/yourprofile",
      label: "LinkedIn",
    },
    {
      key: "github",
      icon: Github,
      type: "text",
      placeholder: "github.com/yourusername",
      label: "GitHub",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">
          Personal Information
        </h2>
        <p className="text-sm text-slate-500">
          Contact details and links visible on your profile.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map(({ key, icon: Icon, type, placeholder, label }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {label}
            </label>
            <div className="relative">
              <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type={type}
                value={data?.[key] || ""}
                onChange={(e) => update(key, e.target.value)}
                placeholder={placeholder}
                className="input-field pl-9"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
