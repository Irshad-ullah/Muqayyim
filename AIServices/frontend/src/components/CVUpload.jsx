import React, { useState, useRef } from 'react';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';

/**
 * CVUpload Component (FE-1: File Upload)
 * - Upload CV in PDF, DOC, or DOCX formats
 * - Client-side validation: file type, max size (5MB)
 * - Show upload progress indicator
 * - Store file temporarily for processing
 */
const CVUpload = ({ onUploadSuccess, onUploadError }) => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const fileInputRef = useRef(null);

  const ALLOWED_FORMATS = ['pdf', 'doc', 'docx'];
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  // Validate file format
  const validateFileFormat = (fileName) => {
    const extension = fileName.split('.').pop().toLowerCase();
    return ALLOWED_FORMATS.includes(extension);
  };

  // Validate file size
  const validateFileSize = (fileSize) => {
    return fileSize <= MAX_FILE_SIZE;
  };

  // Handle file selection from input
  const handleFileSelect = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      validateAndProcessFile(selectedFile);
    }
  };

  // Handle drag and drop
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      validateAndProcessFile(droppedFile);
    }
  };

  // Validate and process file
  const validateAndProcessFile = (selectedFile) => {
    setError(null);
    setSuccess(null);

    // Validate format
    if (!validateFileFormat(selectedFile.name)) {
      const errorMsg = `Invalid file format. Please upload PDF, DOC, or DOCX files.`;
      setError(errorMsg);
      onUploadError?.(errorMsg);
      return;
    }

    // Validate size
    if (!validateFileSize(selectedFile.size)) {
      const errorMsg = `File size exceeds 5MB limit. Current size: ${(selectedFile.size / 1024 / 1024).toFixed(2)}MB`;
      setError(errorMsg);
      onUploadError?.(errorMsg);
      return;
    }

    setFile(selectedFile);
  };

  // Read JWT from the shared localhost cookie (set by Module 1 on login/register).
  // Falls back to localStorage 'authToken' for the URL-param bootstrap path.
  const getToken = () => {
    const match = document.cookie.match(/(?:^|;\s*)muqayyim_jwt=([^;]+)/);
    return match ? match[1] : localStorage.getItem('authToken');
  };

  // Upload file to server
  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + Math.random() * 30;
        });
      }, 300);

      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/cv/upload`,
        {
          method: 'POST',
          body: formData,
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
          },
        }
      );

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Upload failed');
      }

      const data = await response.json();
      setSuccess(`File uploaded successfully! File ID: ${data.file_id}`);
      onUploadSuccess?.(data);

      // Reset after 2 seconds
      setTimeout(() => {
        setFile(null);
        setUploadProgress(0);
        setSuccess(null);
      }, 2000);
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.');
      onUploadError?.(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveFile = () => {
    setFile(null);
    setUploadProgress(0);
    setError(null);
    setSuccess(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Upload Your CV</h2>
        <p className="text-gray-600">
          Upload your CV in PDF, DOC, or DOCX format (max 5MB) for automatic parsing
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-800">Error</h3>
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-green-800">Success</h3>
            <p className="text-green-700 text-sm">{success}</p>
          </div>
        </div>
      )}

      {/* Drag and Drop Area */}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          file ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          accept=".pdf,.doc,.docx"
          className="hidden"
          disabled={uploading}
        />
        <div onClick={() => fileInputRef.current?.click()} className="space-y-3">
          <Upload className="w-12 h-12 mx-auto text-gray-400" />
          <div>
            <p className="font-semibold text-gray-800">
              {file ? `Selected: ${file.name}` : 'Drag and drop your CV here'}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              or click to browse from your computer
            </p>
          </div>
          <p className="text-xs text-gray-500">
            Supported formats: PDF, DOC, DOCX (Max 5MB)
          </p>
        </div>
      </div>

      {/* File Details */}
      {file && (
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-semibold text-gray-800">{file.name}</p>
              <p className="text-sm text-gray-600">
                {(file.size / 1024).toFixed(2)} KB
              </p>
            </div>
            <button
              onClick={handleRemoveFile}
              className="text-red-600 hover:text-red-800 font-medium"
              disabled={uploading}
            >
              Remove
            </button>
          </div>

          {/* Upload Progress */}
          {uploading && (
            <div className="space-y-2">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-600">
                Uploading... {Math.round(uploadProgress)}%
              </p>
            </div>
          )}
        </div>
      )}

      {/* Upload Button */}
      <div className="mt-6 flex gap-3">
        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-colors ${
            file && !uploading
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-300 text-gray-600 cursor-not-allowed'
          }`}
        >
          {uploading ? 'Uploading...' : 'Upload CV'}
        </button>
      </div>
    </div>
  );
};

export default CVUpload;
