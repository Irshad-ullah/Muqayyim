import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle, AlertCircle, Upload, ArrowLeft, X } from 'lucide-react';
import Navbar from '../components/Navbar.jsx';
import ParsedSummary from '../components/cv/ParsedSummary.jsx';
import { cvService } from '../services/cvService.js';
import toast from 'react-hot-toast';

const GATEWAY_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

const updateCVStatus = async (cvStatus) => {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    await fetch(`${GATEWAY_URL}/api/auth/cv-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cvStatus }),
    });
  } catch {
    // Non-critical
  }
};

const STEPS = ['upload', 'parsing', 'review', 'success'];

const CVParsingPage = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState('upload');
  const [fileId, setFileId] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [editedData, setEditedData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── Upload state ──────────────────────────────────────────────
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);

  const ALLOWED = ['pdf', 'doc', 'docx'];
  const MAX_SIZE = 5 * 1024 * 1024;

  const validateAndSetFile = (selected) => {
    setUploadError(null);
    const ext = selected.name.split('.').pop().toLowerCase();
    if (!ALLOWED.includes(ext)) {
      setUploadError('Invalid file format. Please upload PDF, DOC, or DOCX.');
      return;
    }
    if (selected.size > MAX_SIZE) {
      setUploadError(`File exceeds 5 MB limit (${(selected.size / 1024 / 1024).toFixed(2)} MB).`);
      return;
    }
    setFile(selected);
  };

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files?.[0]; if (f) validateAndSetFile(f); };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    const interval = setInterval(() => {
      setUploadProgress((p) => (p >= 90 ? p : p + Math.random() * 30));
    }, 300);

    try {
      const data = await cvService.uploadCV(file);
      clearInterval(interval);
      setUploadProgress(100);

      setFileId(data.file_id);
      setCurrentStep('parsing');
      setError(null);
      toast.success('File uploaded! Starting CV parsing…');
      await updateCVStatus('Uploaded');
      await triggerParsing(data.file_id);
    } catch (err) {
      clearInterval(interval);
      const msg = err.message || 'Upload failed';
      setUploadError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const triggerParsing = async (fid) => {
    try {
      setIsLoading(true);
      const data = await cvService.parseCV(fid);

      if (data.skills) {
        data.skills = Array.from(
          new Map(data.skills.map((s) => [s.name.toLowerCase(), s])).values()
        );
      }

      setParsedData(data);
      setEditedData(JSON.parse(JSON.stringify(data)));
      setCurrentStep('review');
      await updateCVStatus('Processing');
      toast.success('CV parsed successfully!');
    } catch (err) {
      const msg = err.message || 'Parsing failed';
      setError(msg);
      toast.error(msg);
      setCurrentStep('upload');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (editAction) => {
    const d = JSON.parse(JSON.stringify(editedData));
    switch (editAction.type) {
      case 'skill_add':
        (d.skills = d.skills || []).push(editAction.data);
        break;
      case 'skill_update': {
        const i = d.skills?.findIndex((s) => s.name.toLowerCase() === editAction.oldName.toLowerCase());
        if (i !== -1) d.skills[i] = editAction.data;
        break;
      }
      case 'education_add':
        (d.education = d.education || []).push(editAction.data);
        break;
      case 'education_update':
        if (d.education?.[editAction.index]) d.education[editAction.index] = editAction.data;
        break;
      case 'experience_add':
        (d.experience = d.experience || []).push(editAction.data);
        break;
      case 'experience_update':
        if (d.experience?.[editAction.index]) d.experience[editAction.index] = editAction.data;
        break;
      default:
        break;
    }
    setEditedData(d);
  };

  const handleDelete = (deleteAction) => {
    const d = JSON.parse(JSON.stringify(editedData));
    switch (deleteAction.type) {
      case 'skill':
        d.skills = d.skills?.filter((s) => s.name !== deleteAction.name);
        break;
      case 'education':
        d.education = d.education?.filter((_, i) => i !== deleteAction.index);
        break;
      case 'experience':
        d.experience = d.experience?.filter((_, i) => i !== deleteAction.index);
        break;
      default:
        break;
    }
    setEditedData(d);
  };

  const handleSave = async () => {
    try {
      setIsLoading(true);
      await cvService.verifyCVData(fileId, editedData);
      await updateCVStatus('Verified');
      setCurrentStep('success');
      toast.success('CV data saved to your profile!');
    } catch (err) {
      const msg = err.message || 'Failed to save data';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setCurrentStep('upload');
    setFileId(null);
    setParsedData(null);
    setEditedData(null);
    setError(null);
    setFile(null);
    setUploadProgress(0);
    setUploadError(null);
  };

  const stepIndex = (s) => STEPS.indexOf(s);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <Navbar />

      <main className="pt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Back button */}
          <div className="mb-6">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
          </div>

          {/* Header */}
          <div className="text-center mb-10">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">CV Parsing & Skill Extraction</h1>
            <p className="text-gray-600 text-lg">Upload your CV to automatically extract skills, education, and experience</p>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center justify-center gap-4 mb-10 flex-wrap">
            {STEPS.map((s, index) => (
              <React.Fragment key={s}>
                <div
                  className={`flex items-center justify-center w-10 h-10 rounded-full font-bold transition-all ${
                    currentStep === s
                      ? 'bg-blue-600 text-white scale-110'
                      : stepIndex(currentStep) > index
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {stepIndex(currentStep) > index ? '✓' : index + 1}
                </div>
                {index < STEPS.length - 1 && (
                  <div className={`h-1 w-12 transition-all ${stepIndex(currentStep) > index ? 'bg-green-600' : 'bg-gray-200'}`} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Main Content */}
          <div className="bg-white rounded-lg shadow-lg p-8">

            {/* Upload Step */}
            {currentStep === 'upload' && (
              <div className="w-full max-w-2xl mx-auto space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800 mb-2">Upload Your CV</h2>
                  <p className="text-gray-600">Upload your CV in PDF, DOC, or DOCX format (max 5 MB) for automatic parsing</p>
                </div>

                {uploadError && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div><h3 className="font-semibold text-red-800">Error</h3><p className="text-red-700 text-sm">{uploadError}</p></div>
                  </div>
                )}

                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('cv-file-input').click()}
                  className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                    file ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
                  }`}
                >
                  <input
                    id="cv-file-input"
                    type="file"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) validateAndSetFile(f); }}
                    accept=".pdf,.doc,.docx"
                    className="hidden"
                    disabled={uploading}
                  />
                  <div className="space-y-3">
                    <Upload className="w-12 h-12 mx-auto text-gray-400" />
                    <div>
                      <p className="font-semibold text-gray-800">{file ? `Selected: ${file.name}` : 'Drag and drop your CV here'}</p>
                      <p className="text-sm text-gray-600 mt-1">or click to browse from your computer</p>
                    </div>
                    <p className="text-xs text-gray-500">Supported formats: PDF, DOC, DOCX (Max 5 MB)</p>
                  </div>
                </div>

                {file && (
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-semibold text-gray-800">{file.name}</p>
                        <p className="text-sm text-gray-600">{(file.size / 1024).toFixed(2)} KB</p>
                      </div>
                      <button onClick={() => { setFile(null); setUploadProgress(0); setUploadError(null); }} className="text-red-600 hover:text-red-800 font-medium" disabled={uploading}>
                        Remove
                      </button>
                    </div>
                    {uploading && (
                      <div className="space-y-2">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                        </div>
                        <p className="text-xs text-gray-600">Uploading… {Math.round(uploadProgress)}%</p>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={handleUpload}
                  disabled={!file || uploading}
                  className={`w-full py-2 px-4 rounded-lg font-semibold transition-colors ${
                    file && !uploading ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-300 text-gray-600 cursor-not-allowed'
                  }`}
                >
                  {uploading ? 'Uploading…' : 'Upload CV'}
                </button>
              </div>
            )}

            {/* Parsing Step */}
            {currentStep === 'parsing' && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin mb-4">
                  <svg className="w-12 h-12 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" strokeWidth="2" opacity="0.3" />
                    <path stroke="currentColor" strokeWidth="2" d="M2 12a10 10 0 0120 0" strokeDasharray="60" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">Parsing your CV…</h3>
                <p className="text-gray-600">Our AI is extracting skills, education, and experience.</p>
                <p className="text-gray-500 text-sm mt-2">This usually takes 10–30 seconds</p>
              </div>
            )}

            {/* Review Step */}
            {currentStep === 'review' && (
              <ParsedSummary
                parsedData={editedData}
                isLoading={isLoading}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onSave={handleSave}
              />
            )}

            {/* Success Step */}
            {currentStep === 'success' && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle className="w-16 h-16 text-green-600 mb-4" />
                <h3 className="text-2xl font-bold text-gray-800 mb-2">Success!</h3>
                <p className="text-gray-600 mb-8">
                  Your CV has been parsed and saved to your profile.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={handleReset}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Upload Another CV
                  </button>
                  <Link
                    to="/dashboard"
                    className="px-6 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    Back to Dashboard
                  </Link>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && currentStep !== 'upload' && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 mt-6">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-red-800">Error</h3>
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default CVParsingPage;
