import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ChevronLeft,
  Save,
  Download,
  RefreshCw,
  FileSearch,
  AlertTriangle,
  Info,
  X,
  PenSquare,
  FileUp,
  LayoutTemplate,
  ListChecks,
} from 'lucide-react';
import Navbar from '../components/Navbar.jsx';
import CvEditor from '../components/cvgen/CvEditor.jsx';
import DesignPanel from '../components/cvgen/DesignPanel.jsx';
import CvPreview from '../components/cvgen/CvPreview.jsx';
import { DEFAULT_SETTINGS, SECTION_KEYS, resolveAccent, validateCv } from '../components/cvgen/cvModel.js';
import { cvGeneratorService } from '../services/cvGeneratorService.js';

// Module 4 — AI-Powered CV Generator.
// /cv-generator       → new CV built from the user's profile data
// /cv-generator/:id   → reopen a saved CV snapshot
//
// The CV is generated deterministically from structured profile data; the
// AI writing buttons inside the editor are placeholders for a later release.

const loadPdfExport = () => import('../components/cvgen/pdfExport.jsx');

const normalizeSettings = (s = {}) => {
  const order = (s.sectionOrder || []).filter((k) => SECTION_KEYS.includes(k));
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    accentColor: resolveAccent(s.accentColor),
    sectionOrder: [...order, ...SECTION_KEYS.filter((k) => !order.includes(k))],
    hiddenSections: (s.hiddenSections || []).filter((k) => SECTION_KEYS.includes(k)),
  };
};

const normalizeData = (d = {}) => ({
  personal: { fullName: '', headline: '', email: '', phone: '', location: '', linkedin: '', github: '', website: '', ...d.personal },
  summary: d.summary || '',
  skills: d.skills || [],
  experience: d.experience || [],
  education: d.education || [],
  projects: d.projects || [],
  certifications: d.certifications || [],
});

export default function CVGeneratorPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [cv, setCv] = useState(null); // { title, template, settings, data }
  const [sources, setSources] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState('content');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [resnapshot, setResnapshot] = useState(false);

  const fromSource = (res) => ({
    title: res.data.personal?.fullName ? `${res.data.personal.fullName} CV` : 'My CV',
    template: 'classic',
    settings: normalizeSettings(res.settings),
    data: normalizeData(res.data),
  });

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    const load = id
      ? cvGeneratorService.getCv(id).then(({ cv: saved }) => ({
          title: saved.title,
          template: saved.template,
          settings: normalizeSettings(saved.settings),
          data: normalizeData(saved.data),
          snapshotAt: saved.snapshotAt,
          updatedAt: saved.updatedAt,
        }))
      : cvGeneratorService.getCvSource().then((res) => {
          if (!cancelled) setSources(res.sources);
          return fromSource(res);
        });

    load
      .then((next) => {
        if (cancelled) return;
        setCv(next);
        setDirty(false);
      })
      .catch((err) => !cancelled && setLoadError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => () => pdfUrl && URL.revokeObjectURL(pdfUrl), [pdfUrl]);

  const patch = useCallback((p) => {
    setCv((c) => ({ ...c, ...p }));
    setDirty(true);
  }, []);

  const errors = useMemo(() => (cv ? validateCv(cv.data) : []), [cv]);
  const blocked = errors.length > 0;

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (blocked) return toast.error(errors[0]);
    setSaving(true);
    try {
      const payload = { title: cv.title, template: cv.template, settings: cv.settings, data: cv.data };
      if (id) {
        const { cv: saved } = await cvGeneratorService.updateCv(id, { ...payload, resnapshot });
        setCv((c) => ({ ...c, snapshotAt: saved.snapshotAt, updatedAt: saved.updatedAt }));
        setResnapshot(false);
        setDirty(false);
        toast.success('CV updated');
      } else {
        const { cv: saved } = await cvGeneratorService.createCv({ ...payload, sources });
        setDirty(false);
        toast.success('CV saved to your dashboard');
        navigate(`/cv-generator/${saved._id}`, { replace: true });
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const withPdf = async (fn) => {
    if (blocked) return toast.error(errors[0]);
    setExporting(true);
    try {
      const mod = await loadPdfExport();
      await fn(mod);
    } catch (err) {
      console.error('PDF generation failed:', err);
      toast.error('Could not generate the PDF. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = () => withPdf((m) => m.downloadCvPdf(cv));
  const handlePreviewPdf = () =>
    withPdf(async (m) => {
      const blob = await m.renderCvPdfBlob(cv);
      setPdfUrl(URL.createObjectURL(blob));
    });

  const handleReloadFromProfile = async () => {
    const msg = id
      ? 'Replace this CV’s content with your current profile data? Your template and design settings are kept, but edits made only in this CV will be lost.'
      : 'Reload content from your profile? Edits made here will be lost.';
    if (!window.confirm(msg)) return;
    try {
      const res = await cvGeneratorService.getCvSource();
      setSources(res.sources);
      setCv((c) => ({ ...c, data: normalizeData(res.data) }));
      setDirty(true);
      if (id) setResnapshot(true);
      toast.success('Content reloaded from your profile');
    } catch (err) {
      toast.error(err.message);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <main className="pt-16 flex items-center justify-center" style={{ minHeight: 'calc(100vh - 4rem)' }}>
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </main>
      </div>
    );
  }

  if (loadError || !cv) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <main className="pt-16">
          <div className="max-w-xl mx-auto px-4 py-16">
            <div className="card p-10 text-center">
              <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <p className="font-semibold text-slate-800">{loadError || 'CV not found'}</p>
              <p className="text-sm text-slate-500 mt-1">
                {id ? 'This CV may have been deleted or does not belong to your account.' : 'Please try again in a moment.'}
              </p>
              <div className="flex gap-3 justify-center mt-6">
                <Link to="/dashboard" className="btn-secondary w-auto px-5 text-sm">Back to dashboard</Link>
                {id && <Link to="/cv-generator" className="btn-primary w-auto px-5 text-sm">Create a new CV</Link>}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const noSourceData = !id && sources && !sources.profile && !sources.parsedCv;

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="pt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
            <div className="flex items-center gap-3 min-w-0">
              <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition-colors">
                <ChevronLeft className="w-4 h-4" /> Back
              </Link>
              <div className="w-px h-5 bg-slate-200" />
              <div className="min-w-0">
                <input
                  value={cv.title}
                  maxLength={120}
                  onChange={(e) => patch({ title: e.target.value })}
                  className="text-xl font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-indigo-400 focus:outline-none w-full max-w-xs"
                  aria-label="CV title"
                />
                <p className="text-xs text-slate-400 mt-0.5">
                  {id
                    ? `Saved CV · ${dirty ? 'unsaved changes' : `last saved ${new Date(cv.updatedAt).toLocaleString()}`}`
                    : 'New CV · not saved yet'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={handleReloadFromProfile} className="btn-secondary w-auto px-3 py-2 text-sm" title="Rebuild the content from your current profile">
                <RefreshCw className="w-4 h-4" /> <span className="hidden sm:inline">Reload from profile</span>
              </button>
              <button onClick={handlePreviewPdf} disabled={exporting || blocked} className="btn-secondary w-auto px-3 py-2 text-sm disabled:opacity-50">
                <FileSearch className="w-4 h-4" /> <span className="hidden sm:inline">Preview PDF</span>
              </button>
              <button onClick={handleDownload} disabled={exporting || blocked} className="btn-secondary w-auto px-3 py-2 text-sm disabled:opacity-50">
                {exporting ? <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" /> : <Download className="w-4 h-4" />}
                <span className="hidden sm:inline">Download PDF</span>
              </button>
              <button onClick={handleSave} disabled={saving || blocked || (id && !dirty)} className="btn-primary w-auto px-4 py-2 text-sm">
                {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                {id ? 'Save changes' : 'Save CV'}
              </button>
            </div>
          </div>

          {/* Banners */}
          {noSourceData && (
            <div className="flex items-start gap-3 p-4 mb-4 bg-amber-50 rounded-xl border border-amber-100">
              <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800">No profile data found yet</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Build your profile or upload a CV so it can be filled in automatically — or enter the details below manually.
                </p>
                <div className="flex gap-3 mt-2">
                  <Link to="/profile-builder" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 hover:underline">
                    <PenSquare className="w-3.5 h-3.5" /> Profile Builder
                  </Link>
                  <Link to="/cv-parsing" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 hover:underline">
                    <FileUp className="w-3.5 h-3.5" /> Upload CV
                  </Link>
                </div>
              </div>
            </div>
          )}
          {!id && sources && (sources.profile || sources.parsedCv) && (
            <div className="flex items-start gap-3 p-3 mb-4 bg-blue-50 rounded-xl border border-blue-100">
              <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">
                Filled in from your{' '}
                {[sources.profile && 'Profile Builder data', sources.parsedCv && `parsed CV${sources.parsedCvStatus === 'verified' ? ' (verified)' : ''}`]
                  .filter(Boolean)
                  .join(' and ')}
                . Edits you make here only affect this CV, not your profile.
              </p>
            </div>
          )}
          {blocked && (
            <div className="flex items-start gap-3 p-3 mb-4 bg-red-50 rounded-xl border border-red-100">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-red-700">
                <p className="font-semibold">Fix the following before saving or downloading:</p>
                <ul className="list-disc ml-4 mt-1 space-y-0.5">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Editor */}
            <div>
              <div className="inline-flex bg-white border border-slate-100 rounded-xl p-1 mb-3 shadow-sm">
                {[
                  { key: 'content', label: 'Content', icon: ListChecks },
                  { key: 'design', label: 'Design', icon: LayoutTemplate },
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
                      tab === key ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" /> {label}
                  </button>
                ))}
              </div>

              {tab === 'content' ? (
                <CvEditor data={cv.data} onChange={(data) => patch({ data })} />
              ) : (
                <DesignPanel
                  template={cv.template}
                  settings={cv.settings}
                  data={cv.data}
                  onTemplate={(template) => patch({ template })}
                  onSettings={(settings) => patch({ settings })}
                />
              )}
            </div>

            {/* Live preview */}
            <div className="lg:sticky lg:top-20">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-slate-700">Live preview</h2>
                <span className="text-xs text-slate-400">Use “Preview PDF” for exact page breaks</span>
              </div>
              <div className="bg-slate-200/60 rounded-2xl p-4 lg:max-h-[calc(100vh-9rem)] overflow-y-auto">
                <CvPreview data={cv.data} settings={cv.settings} template={cv.template} />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* PDF preview modal */}
      {pdfUrl && (
        <div className="fixed inset-0 z-[60] bg-slate-900/60 flex items-center justify-center p-4" onClick={() => setPdfUrl(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">PDF preview</h3>
              <div className="flex items-center gap-2">
                <button onClick={handleDownload} className="btn-primary w-auto px-3 py-1.5 text-xs">
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
                <button onClick={() => setPdfUrl(null)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <iframe title="CV PDF preview" src={pdfUrl} className="flex-1 w-full rounded-b-2xl" />
          </div>
        </div>
      )}
    </div>
  );
}
