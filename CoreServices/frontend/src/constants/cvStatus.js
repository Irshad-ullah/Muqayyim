// CV processing status — same enum as CoreServices/AIServices. The server owns
// the value (AIServices pushes it); the UI only maps it to labels.
export const CV_STATUS = Object.freeze({
  NOT_UPLOADED: 'not_uploaded',
  UPLOADED: 'uploaded',
  PROCESSING: 'processing',
  PARSED: 'parsed',
  VERIFIED: 'verified',
  FAILED: 'failed',
});

export const CV_STATUS_LABELS = {
  not_uploaded: 'Not Uploaded',
  uploaded: 'Uploaded',
  processing: 'Processing',
  parsed: 'Parsed',
  verified: 'Verified',
  failed: 'Failed',
};

export const cvStatusLabel = (status) => CV_STATUS_LABELS[status] || status || CV_STATUS_LABELS.not_uploaded;
