import React, { useState } from 'react';
import { Phone, MapPin, Linkedin, Github, Globe, Plus, X, Award } from 'lucide-react';
import { PROFILE_LIMITS as L } from '../../../constants/profileLimits.js';
import { errorFor, errorsUnder, validateProfile } from '../../../validation/validateProfile.js';
import { FieldError, errorClass, errorProps } from '../FieldErrors.jsx';

const EMPTY_CERT = { name: '', issuer: '', date: '', url: '' };

export default function Step1BasicInfo({ profile, onChange, errors = [] }) {
  const [newCert, setNewCert] = useState(EMPTY_CERT);
  const [addingCert, setAddingCert] = useState(false);
  const [certErrors, setCertErrors] = useState([]);
  // Certifications being fixed in place (stay open while typing).
  const [editingCerts, setEditingCerts] = useState(() => new Set());

  const updateInfo = (field, value) =>
    onChange({ personalInfo: { ...profile.personalInfo, [field]: value } });

  // FR5.6: name and issuer required, http(s) link, date not in the future.
  // Checked with the same rules as the server before the entry is added.
  const addCert = () => {
    const found = validateProfile({ certifications: [newCert] }).map((e) => ({
      ...e,
      field: e.field.replace('certifications[0]', 'new'),
    }));
    if (found.length) return setCertErrors(found);
    onChange({ certifications: [...(profile.certifications || []), { ...newCert }] });
    setNewCert(EMPTY_CERT);
    setCertErrors([]);
    setAddingCert(false);
  };

  const removeCert = (i) => {
    setEditingCerts(new Set()); // indexes shift after a removal
    onChange({ certifications: profile.certifications.filter((_, idx) => idx !== i) });
  };

  // FR5.1: digits, spaces, + - ( ) only; 7–20 characters with at least 7 digits.
  const handlePhoneChange = (raw) => updateInfo('phone', raw.replace(/[^0-9+()\- ]/g, ''));

  const infoFields = [
    { key: 'phone',    Icon: Phone,    type: 'tel',  placeholder: '+1 (555) 000-0000',          label: 'Phone',    max: L.phone.max },
    { key: 'location', Icon: MapPin,   type: 'text', placeholder: 'City, Country',               label: 'Location', max: L.locationMax },
    { key: 'linkedin', Icon: Linkedin, type: 'text', placeholder: 'linkedin.com/in/yourprofile', label: 'LinkedIn', max: L.urlMax },
    { key: 'github',   Icon: Github,   type: 'text', placeholder: 'github.com/yourusername',     label: 'GitHub',   max: L.urlMax },
    { key: 'website',  Icon: Globe,    type: 'text', placeholder: 'https://yourportfolio.com',   label: 'Website',  max: L.urlMax },
  ];

  const certFields = [
    { key: 'name',   label: 'Name *',   placeholder: 'AWS Certified Developer', max: L.titleMax },
    { key: 'issuer', label: 'Issuer *', placeholder: 'Amazon Web Services',     max: L.orgMax },
    { key: 'date',   label: 'Date',     placeholder: '2024-01 or Jan 2024' },
    { key: 'url',    label: 'URL',      placeholder: 'https://…',               max: L.urlMax },
  ];

  const summaryError = errorFor(errors, 'summary');

  return (
    <div className="space-y-8">

      {/* Personal Info */}
      <section>
        <h3 className="text-base font-semibold text-slate-800 mb-4">Contact &amp; Links</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {infoFields.map(({ key, Icon, type, placeholder, label, max }) => {
            const message = errorFor(errors, `personalInfo.${key}`);
            return (
              <div key={key}>
                <label className="label" htmlFor={`pi-${key}`}>{label}</label>
                <div className="relative">
                  <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    id={`pi-${key}`}
                    type={type}
                    maxLength={max}
                    value={profile.personalInfo?.[key] || ''}
                    onChange={(e) =>
                      key === 'phone'
                        ? handlePhoneChange(e.target.value)
                        : updateInfo(key, e.target.value)
                    }
                    placeholder={placeholder}
                    className={`input-field pl-9${errorClass(message)}`}
                    {...errorProps(`pi-${key}`, message)}
                  />
                </div>
                <FieldError id={`err-pi-${key}`} message={message} />
              </div>
            );
          })}
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
          className={`input-field resize-none${errorClass(summaryError)}`}
          maxLength={L.summaryMax}
          {...errorProps('summary', summaryError)}
        />
        <FieldError id="err-summary" message={summaryError} />
        <p className="text-xs text-slate-400 mt-1 text-right">
          {(profile.summary || '').length} / {L.summaryMax}
        </p>
      </section>

      {/* Certifications */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-slate-800">Certifications</h3>
          {(profile.certifications?.length || 0) < L.maxEntries.certifications && (
            <button
              onClick={() => setAddingCert(true)}
              className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          )}
        </div>

        {!profile.certifications?.length && !addingCert && (
          <p className="text-sm text-slate-400 italic">No certifications added yet.</p>
        )}

        <div className="space-y-2">
          {profile.certifications?.map((c, i) => {
            const certErrs = errorsUnder(errors, `certifications[${i}]`);
            return (
              <div
                key={i}
                data-testid={`certification-${i}`}
                className={`flex items-start justify-between p-3 bg-slate-50 rounded-xl border ${certErrs.length ? 'border-red-300' : 'border-slate-100'}`}
              >
                {certErrs.length > 0 || editingCerts.has(i) ? (
                  // A certification with problems (e.g. imported without an
                  // issuer) is edited in place, with the error under each field.
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
                    {certFields.map(({ key, label, placeholder, max }) => {
                      const message = errorFor(errors, `certifications[${i}].${key}`);
                      return (
                        <div key={key}>
                          <label className="text-xs font-medium text-slate-600" htmlFor={`cert-${i}-${key}`}>{label}</label>
                          <input
                            id={`cert-${i}-${key}`}
                            value={c[key] || ''}
                            maxLength={max}
                            placeholder={placeholder}
                            onChange={(e) => {
                              setEditingCerts((prev) => new Set(prev).add(i));
                              onChange({
                                certifications: profile.certifications.map((x, idx) => (idx === i ? { ...x, [key]: e.target.value } : x)),
                              });
                            }}
                            className={`input-field text-sm${errorClass(message)}`}
                            {...errorProps(`cert-${i}-${key}`, message)}
                          />
                          <FieldError id={`err-cert-${i}-${key}`} message={message} />
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setEditingCerts((prev) => { const next = new Set(prev); next.delete(i); return next; })}
                      className="text-xs text-indigo-600 font-medium justify-self-start"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                    {c.issuer && <p className="text-xs text-slate-500">{c.issuer}{c.date ? ` · ${c.date}` : ''}</p>}
                    {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">{c.url}</a>}
                  </div>
                )}
                <button onClick={() => removeCert(i)} aria-label={`Remove certification ${i + 1}`} className="text-slate-300 hover:text-red-500 ml-3 flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>

        {addingCert && (
          <div className="mt-3 p-4 border border-indigo-100 bg-indigo-50/40 rounded-xl space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {certFields.map(({ key, label, placeholder, max }) => {
                const message = errorFor(certErrors, `new.${key}`);
                return (
                  <div key={key}>
                    <label className="label" htmlFor={`cert-${key}`}>{label}</label>
                    <input
                      id={`cert-${key}`}
                      value={newCert[key]}
                      maxLength={max}
                      onChange={(e) => setNewCert((p) => ({ ...p, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className={`input-field${errorClass(message)}`}
                      {...errorProps(`cert-${key}`, message)}
                    />
                    <FieldError id={`err-cert-${key}`} message={message} />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setAddingCert(false); setCertErrors([]); }} className="btn-secondary px-4 py-2 text-sm w-auto">Cancel</button>
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
