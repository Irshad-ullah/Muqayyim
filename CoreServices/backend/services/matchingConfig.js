import SystemConfig from '../admin/models/SystemConfig.js';

// Module 5.2: the career-matching scoring mode lives in systemconfigs (admin-editable on the Configuration page).
//   matching.related_credit = false (default)  credit only for an exact skill, an alias or an any-of alternative;
//                                              semantic neighbours are returned as display-only hints
//   matching.related_credit = true             the earlier 0.5 related-credit rule
// Core sends it to AIServices with every career-match request as X-Related-Credit; AI treats anything but "true" as
// false. The mode is part of AI's career-match cache key, so switching it refreshes everyone's results.

export const RELATED_CREDIT_KEY = 'matching.related_credit';

export const relatedCreditEnabled = async () => {
  try {
    const doc = await SystemConfig.findOne({ key: RELATED_CREDIT_KEY }).lean();
    return doc?.value === true || doc?.value === 'true';
  } catch {
    return false; // the default when the configuration cannot be read
  }
};

// Startup: create the key with its default if it does not exist (an existing value is never changed).
export const ensureMatchingConfig = async () => {
  await SystemConfig.updateOne(
    { key: RELATED_CREDIT_KEY },
    {
      $setOnInsert: {
        key: RELATED_CREDIT_KEY,
        value: false,
        dataType: 'boolean',
        category: 'matching',
        description: 'Career matching: give 0.5 credit for semantically related skills (true) or only for exact, '
          + 'alias and any-of matches with related skills shown as hints (false, default; Module 5.2).',
      },
    },
    { upsert: true },
  );
};
