import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Plus, Download, Trash2, PenSquare } from 'lucide-react';
import { cvGeneratorService } from '../../services/cvGeneratorService.js';
import { TEMPLATES } from './cvModel.js';

// Module 4 — "My CVs" dashboard card: saved CV snapshots with open/download/delete.

const templateName = (id) => TEMPLATES.find((t) => t.id === id)?.name || id;

export default function SavedCvsCard() {
  const [cvs, setCvs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    cvGeneratorService
      .listCvs()
      .then(({ cvs: list }) => setCvs(list || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleDownload = async (id) => {
    setBusyId(id);
    try {
      const [{ cv }, { downloadCvPdf }] = await Promise.all([
        cvGeneratorService.getCv(id),
        import('./pdfExport.jsx'),
      ]);
      await downloadCvPdf(cv);
    } catch (err) {
      toast.error(err.message || 'Could not generate the PDF');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (cv) => {
    if (!window.confirm(`Delete "${cv.title}"? This cannot be undone.`)) return;
    setBusyId(cv._id);
    try {
      await cvGeneratorService.deleteCv(cv._id);
      setCvs((list) => list.filter((c) => c._id !== cv._id));
      toast.success('CV deleted');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="lg:col-span-3 card p-6">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">My CVs</h2>
          <p className="text-sm text-slate-500 mt-0.5">ATS-friendly CVs generated from your profile</p>
        </div>
        <Link to="/cv-generator" className="btn-primary w-auto px-4 py-2 text-sm">
          <Plus className="w-4 h-4" /> New CV
        </Link>
      </div>

      {loading && (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && !cvs.length && (
        <div className="flex flex-col items-center text-center py-8 gap-2">
          <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center">
            <FileText className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-sm font-semibold text-slate-700">No saved CVs yet</p>
          <p className="text-xs text-slate-400">Generate a CV from your profile data and save it here.</p>
        </div>
      )}

      {!loading && cvs.length > 0 && (
        <div className="divide-y divide-slate-100">
          {cvs.map((cv) => (
            <div key={cv._id} className="flex items-center gap-4 py-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                <Link to={`/cv-generator/${cv._id}`} className="text-sm font-semibold text-slate-800 hover:text-indigo-600 truncate block">
                  {cv.title}
                </Link>
                <p className="text-xs text-slate-500">
                  {templateName(cv.template)} template · updated {new Date(cv.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Link to={`/cv-generator/${cv._id}`} className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50" title="Open / edit">
                  <PenSquare className="w-4 h-4" />
                </Link>
                <button
                  onClick={() => handleDownload(cv._id)}
                  disabled={busyId === cv._id}
                  className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                  title="Download PDF"
                >
                  {busyId === cv._id ? (
                    <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => handleDelete(cv)}
                  disabled={busyId === cv._id}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
