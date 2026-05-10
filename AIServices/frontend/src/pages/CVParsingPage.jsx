import React, { useState, useEffect } from "react";
import { CheckCircle, AlertCircle } from "lucide-react";
import CVUpload from "../components/CVUpload";
import ParsedSummary from "../components/ParsedSummary";
import { cvService } from "../services/cvService";
import toast from "react-hot-toast";

// VITE_API_URL points to the API Gateway (port 8080).
// The gateway routes /api/auth/* → Module 1, so we can update CV status from here.
const GATEWAY_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

const readToken = () => {
  const match = document.cookie.match(/(?:^|;\s*)muqayyim_jwt=([^;]+)/);
  return match ? match[1] : localStorage.getItem("authToken");
};

// Notify Module 1 of a CV status change. Fire-and-forget — never breaks the CV flow.
const updateCVStatus = async (cvStatus) => {
  const token = readToken();
  if (!token) return;
  try {
    await fetch(`${GATEWAY_URL}/api/auth/cv-status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ cvStatus }),
    });
  } catch {
    // Non-critical — CV parsing continues regardless
  }
};

/**
 * CVParsingPage Component
 * Main page for Module 2: CV Parsing
 * Orchestrates the flow: Upload -> Parse -> Review -> Save
 */
const CVParsingPage = () => {
  const [currentStep, setCurrentStep] = useState("upload"); // upload, parsing, review, success
  const [fileId, setFileId] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [editedData, setEditedData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Handle successful file upload
   * Move to parsing step and trigger NLP parsing
   */
  const handleUploadSuccess = async (uploadResponse) => {
    try {
      setFileId(uploadResponse.file_id);
      setCurrentStep("parsing");
      setError(null);
      toast.success("File uploaded! Starting CV parsing...");
      await updateCVStatus("Uploaded");

      // Trigger NLP parsing
      await triggerParsing(uploadResponse.file_id);
    } catch (err) {
      const errorMsg = err.message || "Failed to process upload";
      setError(errorMsg);
      toast.error(errorMsg);
      setCurrentStep("upload");
    }
  };

  /**
   * Trigger NLP parsing
   * FE-2: Parse uploaded CV using NLP (spaCy/NLTK)
   */
  const triggerParsing = async (fid) => {
    try {
      setIsLoading(true);
      const data = await cvService.parseCV(fid);

      // Deduplicate skills
      if (data.skills) {
        const uniqueSkills = Array.from(
          new Map(
            data.skills.map((skill) => [skill.name.toLowerCase(), skill]),
          ).values(),
        );
        data.skills = uniqueSkills;
      }

      setParsedData(data);
      setEditedData(JSON.parse(JSON.stringify(data))); // Deep copy for editing
      setCurrentStep("review");
      await updateCVStatus("Processing");
      toast.success("CV parsed successfully!");
    } catch (err) {
      const errorMsg = err.message || "Parsing failed";
      setError(errorMsg);
      toast.error(errorMsg);
      setCurrentStep("upload");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle edit operations on parsed data
   * FE-5: Review & Edit
   */
  const handleEdit = (editAction) => {
    const newData = JSON.parse(JSON.stringify(editedData));

    switch (editAction.type) {
      case "skill_add":
        if (!newData.skills) newData.skills = [];
        newData.skills.push(editAction.data);
        break;
      case "skill_update":
        if (newData.skills) {
          const skillIndex = newData.skills.findIndex(
            (s) => s.name.toLowerCase() === editAction.oldName.toLowerCase(),
          );
          if (skillIndex !== -1) {
            newData.skills[skillIndex] = editAction.data;
          }
        }
        break;
      case "education_add":
        if (!newData.education) newData.education = [];
        newData.education.push(editAction.data);
        break;
      case "education_update":
        if (newData.education && newData.education[editAction.index]) {
          newData.education[editAction.index] = editAction.data;
        }
        break;
      case "experience_add":
        if (!newData.experience) newData.experience = [];
        newData.experience.push(editAction.data);
        break;
      case "experience_update":
        if (newData.experience && newData.experience[editAction.index]) {
          newData.experience[editAction.index] = editAction.data;
        }
        break;
      case "project_add":
        if (!newData.projects) newData.projects = [];
        newData.projects.push(editAction.data);
        break;
      case "project_update":
        if (newData.projects && newData.projects[editAction.index]) {
          newData.projects[editAction.index] = editAction.data;
        }
        break;
      default:
        break;
    }

    setEditedData(newData);
  };

  /**
   * Handle delete operations
   * FE-5: Review & Edit
   */
  const handleDelete = (deleteAction) => {
    const newData = JSON.parse(JSON.stringify(editedData));

    switch (deleteAction.type) {
      case "skill":
        if (newData.skills) {
          newData.skills = newData.skills.filter(
            (s) => s.name !== deleteAction.name,
          );
        }
        break;
      case "education":
        if (newData.education) {
          newData.education = newData.education.filter(
            (_, index) => index !== deleteAction.index,
          );
        }
        break;
      case "experience":
        if (newData.experience) {
          newData.experience = newData.experience.filter(
            (_, index) => index !== deleteAction.index,
          );
        }
        break;
      case "project":
        if (newData.projects) {
          newData.projects = newData.projects.filter(
            (_, index) => index !== deleteAction.index,
          );
        }
        break;
      default:
        break;
    }

    setEditedData(newData);
  };

  /**
   * Save verified data to profile
   * FE-4: Store in User Profile
   */
  const handleSave = async () => {
    try {
      setIsLoading(true);
      await cvService.verifyCVData(fileId, editedData);
      await updateCVStatus("Verified");
      setCurrentStep("success");
      toast.success("CV data saved to your profile!");
    } catch (err) {
      const errorMsg = err.message || "Failed to save data";
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle upload error
   */
  const handleUploadError = (errorMsg) => {
    setError(errorMsg);
    toast.error(errorMsg);
  };

  /**
   * Reset and start over
   */
  const handleReset = () => {
    setCurrentStep("upload");
    setFileId(null);
    setParsedData(null);
    setEditedData(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            CV Parsing & Skill Extraction
          </h1>
          <p className="text-gray-600 text-lg">
            Upload your CV to automatically extract skills, education, and
            experience
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-4 mb-12 flex-wrap">
          {[
            { step: "upload", label: "Upload" },
            { step: "parsing", label: "Parsing" },
            { step: "review", label: "Review" },
            { step: "success", label: "Success" },
          ].map((s, index) => (
            <React.Fragment key={s.step}>
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full font-bold transition-all ${
                  currentStep === s.step
                    ? "bg-blue-600 text-white scale-110"
                    : ["parsing", "review", "success"].includes(currentStep) &&
                        ["upload", "parsing", "review", "success"].indexOf(
                          s.step,
                        ) <
                          ["upload", "parsing", "review", "success"].indexOf(
                            currentStep,
                          )
                      ? "bg-green-600 text-white"
                      : "bg-gray-200 text-gray-600"
                }`}
              >
                {["parsing", "review", "success"].includes(currentStep) &&
                ["upload", "parsing", "review", "success"].indexOf(s.step) <
                  ["upload", "parsing", "review", "success"].indexOf(
                    currentStep,
                  ) ? (
                  <span>✓</span>
                ) : (
                  index + 1
                )}
              </div>
              {index < 3 && (
                <div
                  className={`h-1 w-12 transition-all ${
                    ["parsing", "review", "success"].includes(currentStep) &&
                    ["upload", "parsing", "review", "success"].indexOf(s.step) <
                      ["upload", "parsing", "review", "success"].indexOf(
                        currentStep,
                      )
                      ? "bg-green-600"
                      : "bg-gray-200"
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          {/* Upload Step */}
          {currentStep === "upload" && (
            <div className="space-y-6">
              <CVUpload
                onUploadSuccess={handleUploadSuccess}
                onUploadError={handleUploadError}
              />
            </div>
          )}

          {/* Parsing Step */}
          {currentStep === "parsing" && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin mb-4">
                <svg
                  className="w-12 h-12 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="2"
                    opacity="0.3"
                  />
                  <path
                    fill="currentColor"
                    d="M22 12a10 10 0 11-20 0 10 10 0 0120 0z"
                    opacity="0.3"
                  />
                  <path
                    stroke="currentColor"
                    strokeWidth="2"
                    d="M2 12a10 10 0 0120 0"
                    strokeDasharray="60"
                    strokeDashoffset="0"
                    style={{
                      animation: "spin 2s linear infinite",
                    }}
                  />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">
                Parsing your CV...
              </h3>
              <p className="text-gray-600">
                Our AI is extracting skills, education, and experience.
              </p>
              <p className="text-gray-500 text-sm mt-2">
                This usually takes 10-30 seconds
              </p>
            </div>
          )}

          {/* Review Step */}
          {currentStep === "review" && (
            <div className="space-y-6">
              <ParsedSummary
                parsedData={editedData}
                isLoading={isLoading}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onSave={handleSave}
              />
            </div>
          )}

          {/* Success Step */}
          {currentStep === "success" && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle className="w-16 h-16 text-green-600 mb-4" />
              <h3 className="text-2xl font-bold text-gray-800 mb-2">
                Success!
              </h3>
              <p className="text-gray-600 mb-6">
                Your CV has been parsed and saved to your profile. You can now
                proceed to the next step in your career development journey.
              </p>
              <button
                onClick={handleReset}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Upload Another CV
              </button>
            </div>
          )}

          {/* Error Display */}
          {error && currentStep !== "upload" && (
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

      <style>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
};

export default CVParsingPage;
