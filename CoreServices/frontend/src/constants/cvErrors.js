// CV upload / parsing error codes from AIServices (Business Rule 1, LI-1).
// The server sends the same text; these keep the message clear even when a
// proxy or an older server returns only the code.
export const CV_ERROR_MESSAGES = {
  INVALID_FILE_TYPE: 'The file content does not match its extension. Upload a PDF, DOC or DOCX file.',
  ENCRYPTED_FILE: 'This file is password-protected. Remove the password, save it again and upload the new file.',
  DOC_UNSUPPORTED: 'Old .doc files could not be processed. Please save as PDF or DOCX and upload again.',
  NO_TEXT_FOUND: 'No readable text was found. This may be a scanned document. Please upload a text-based PDF or DOCX.',
};

export const cvErrorMessage = (err, fallback) => CV_ERROR_MESSAGES[err?.code] || err?.message || fallback;
