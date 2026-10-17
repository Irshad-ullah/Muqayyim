// LLM features (12): the one-time consent shown before any AI feature sends CV / profile text to
// the provider. The text is served by GET /api/ai/consent, so the dialog always shows exactly this.
// Bump AI_CONSENT_VERSION whenever the text or the provider changes (users are asked again).

export const AI_CONSENT_VERSION = '2026-10-17';
export const AI_CONSENT_PROVIDER = 'Google Gemini';
export const AI_CONSENT_TEXT =
  'Your CV/profile text is sent to Google Gemini for processing. On the free tier, Google may use this content to improve its products.';
