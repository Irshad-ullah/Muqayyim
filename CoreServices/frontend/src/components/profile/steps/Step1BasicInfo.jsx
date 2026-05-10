import React, { useState } from 'react';
import { Phone, MapPin, Linkedin, Github, Plus, X, Award } from 'lucide-react';

export default function Step1BasicInfo({ profile, onChange }) {
  const [newCert, setNewCert] = useState({ name: '', issuer: '', date: '', url: '' });
  const [addingCert, setAddingCert] = useState(false);

  const updateInfo = (field, value) =>
    onChange({ personalInfo: { ...profile.personalInfo, [field]: value } });

  const addCert = () => {
    if (!newCert.name.trim()) return;
    onChange({ certifications: [...profile.certifications, { ...newCert }] });
    setNewCert({ name: '', issuer: '', date: '', url: '' });
    setAddingCert(false);
  };

  const removeCert = (i) =>
    onChange({ certifications: profile.certifications.filter((_, idx) => idx !== i) });

  const [phoneError, setPhoneError] = useState('');

  const handlePhoneChange = (raw) => {
    // Allow only digits; preserve a leading + for country code
    const hasPlus = raw.startsWith('+');
    const digits  = raw.replace(/\D/g, '');
    const filtered = (hasPlus ? '+' : '') + digits;
    updateInfo('phone', filtered);

    if (filtered && (digits.length < 7 || digits.length > 15)) {
      setPhoneError('Enter a valid phone number (7–15 digits)');
    } else {
      setPhoneError('');
    }
  };

  const infoFields = [
    { key: 'phone',    Icon: Phone,    type: 'tel',  placeholder: '+1 (555) 000-0000',          label: 'Phone' },
    { key: 'location', Icon: MapPin,   type: 'text', placeholder: 'City, Country',               label: 'Location' },
    { key: 'linkedin', Icon: Linkedin, type: 'text', placeholder: 'linkedin.com/in/yourprofile', label: 'LinkedIn' },
    { key: 'github',   Icon: Github,   type: 'text', placeholder: 'github.com/yourusername',     label: 'GitHub' },
  ];

  return (
    <div className="space-y-8">

      {/* Personal Info */}
      <section>
        <h3 className="text-base font-semibold text-slate-800 mb-4">Contact &amp; Links</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {infoFields.map(({ key, Icon, type, placeholder, label }) => (
            <div key={key}>
              <label className="label">{label}</label>
              <div className="relative">
                <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type={type}
                  value={profile.personalInfo?.[key] || ''}
                  onChange={(e) =>
                    key === 'phone'
                      ? handlePhoneChange(e.target.value)
                      : updateInfo(key, e.target.value)
                  }
                  placeholder={placeholder}
                  className={`input-field pl-9 ${key === 'phone' && phoneError ? 'border-red-400 focus:ring-red-400' : ''}`}
                />
              </div>
              {key === 'phone' && phoneError && (
                <p className="text-xs text-red-500 mt-1">{phoneError}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Summary */}
      <section>
        <h3 className="text-base font-semibold text-slate-800 mb-2">Professional Summary</h3>
        <p className="text-xs text-slate-500 mb-3">
          A short paragraph that describes your background and goals.
        </p>
        <textarea
          rows={5}
          value={profile.summary || ''}
          onChange={(e) => onChange({ summary: e.target.value })}
          placeholder="e.g. Full-stack developer with 3+ years experience building scalable web applications…"
          className="input-field resize-none"
          maxLength={1000}
        />
        <p className="text-xs text-slate-400 mt-1 text-right">
          {(profile.summary || '').length} / 1000
        </p>
      </section>

      {/* Certifications */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-slate-800">Certifications</h3>
          <button
            onClick={() => setAddingCert(true)}
            className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        {profile.certifications?.length === 0 && !addingCert && (
          <p className="text-sm text-slate-400 italic">No certifications added yet.</p>
        )}

        <div className="space-y-2">
          {profile.certifications?.map((c, i) => (
            <div key={i} className="flex items-start justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
              <div>
                <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                {c.issuer && <p className="text-xs text-slate-500">{c.issuer}{c.date ? ` · ${c.date}` : ''}</p>}
                {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">{c.url}</a>}
              </div>
              <button onClick={() => removeCert(i)} className="text-slate-300 hover:text-red-500 ml-3 flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {addingCert && (
          <div className="mt-3 p-4 border border-indigo-100 bg-indigo-50/40 rounded-xl space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Name *</label>
                <input value={newCert.name} onChange={(e) => setNewCert(p => ({ ...p, name: e.target.value }))}
                  placeholder="AWS Certified Developer" className="input-field" />
              </div>
              <div>
                <label className="label">Issuer</label>
                <input value={newCert.issuer} onChange={(e) => setNewCert(p => ({ ...p, issuer: e.target.value }))}
                  placeholder="Amazon Web Services" className="input-field" />
              </div>
              <div>
                <label className="label">Date</label>
                <input value={newCert.date} onChange={(e) => setNewCert(p => ({ ...p, date: e.target.value }))}
                  placeholder="Jan 2024" className="input-field" />
              </div>
              <div>
                <label className="label">URL</label>
                <input value={newCert.url} onChange={(e) => setNewCert(p => ({ ...p, url: e.target.value }))}
                  placeholder="https://…" className="input-field" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setAddingCert(false)} className="btn-secondary px-4 py-2 text-sm w-auto">Cancel</button>
              <button onClick={addCert} className="btn-primary px-4 py-2 text-sm w-auto">
                <Award className="w-4 h-4" /> Add Certification
              </button>
            </div>
          </div>
        )}
      </section>

    </div>
  );
}
