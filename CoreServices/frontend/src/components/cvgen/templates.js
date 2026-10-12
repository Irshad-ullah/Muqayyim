// Module 4 — template style tokens.
// Every template is a single-column, text-only layout (ATS-friendly). They
// differ only in these tokens; the same CvDocument renders all of them.
// All sizes are in PDF points (1pt = 1/72in).

export const TEMPLATE_STYLES = {
  classic: {
    pagePadding: { top: 40, right: 48, bottom: 40, left: 48 },
    headerAlign: 'center',
    nameSize: 22,
    nameColor: 'text', // 'text' | 'accent'
    headlineSize: 11,
    contactSize: 9,
    headingSize: 11,
    headingColor: 'accent',
    headingUppercase: true,
    headingRule: 'full', // 'full' | 'none'
    sectionGap: 12,
    entryGap: 8,
    bodySize: 10,
    lineHeight: 1.35,
    entryLayout: 'stacked', // title line, then org line
  },
  modern: {
    pagePadding: { top: 40, right: 44, bottom: 40, left: 44 },
    headerAlign: 'left',
    nameSize: 24,
    nameColor: 'accent',
    headlineSize: 12,
    contactSize: 9,
    headingSize: 11.5,
    headingColor: 'accent',
    headingUppercase: false,
    headingRule: 'full',
    sectionGap: 14,
    entryGap: 9,
    bodySize: 10,
    lineHeight: 1.4,
    entryLayout: 'stacked',
  },
  compact: {
    pagePadding: { top: 30, right: 36, bottom: 30, left: 36 },
    headerAlign: 'left',
    nameSize: 18,
    nameColor: 'text',
    headlineSize: 10,
    contactSize: 8.5,
    headingSize: 10,
    headingColor: 'accent',
    headingUppercase: true,
    headingRule: 'full',
    sectionGap: 8,
    entryGap: 5,
    bodySize: 9.2,
    lineHeight: 1.28,
    entryLayout: 'inline', // "Title, Company" on one line
  },
};

export const TEXT_COLOR = '#111827';
export const MUTED_COLOR = '#4b5563';
export const RULE_COLOR = '#d1d5db';
