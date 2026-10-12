// CV processing status — one enum shared by CoreServices, AIServices and the UI.
// CoreServices stores it on the User; only AIServices changes it (via /internal).
export const CV_STATUS = Object.freeze({
  NOT_UPLOADED: 'not_uploaded',
  UPLOADED: 'uploaded',
  PROCESSING: 'processing',
  PARSED: 'parsed',
  VERIFIED: 'verified',
  FAILED: 'failed',
});

export const CV_STATUS_VALUES = Object.values(CV_STATUS);

export const isValidCvStatus = (value) => CV_STATUS_VALUES.includes(value);
