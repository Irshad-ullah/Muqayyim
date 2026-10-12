import React from 'react';
import { Document, Page, View, Text, Link, Font, Svg, Path, Rect, Circle, pdf } from '@react-pdf/renderer';
import CvDocument from './CvDocument.jsx';
import { fileNameFor } from './cvModel.js';
import { CONTACT_ICONS } from './icons.js';

const SVG_ELEMENTS = { path: Path, rect: Rect, circle: Circle };

// Module 4 — PDF export. Loaded lazily (dynamic import) so react-pdf is only
// downloaded when the user actually previews or downloads a PDF.
//
// Uses the PDF standard fonts (Helvetica / Times) so text stays real,
// selectable and searchable — no rasterised content.

// Never hyphenate words: split words hurt ATS keyword matching.
Font.registerHyphenationCallback((word) => [word]);

const PDF_FONTS = { sans: 'Helvetica', serif: 'Times-Roman' };
const mapStyle = (style) =>
  style?.fontFamily ? { ...style, fontFamily: PDF_FONTS[style.fontFamily] || style.fontFamily } : style;

export const pdfPrimitives = {
  Page: ({ style, children }) => (
    <Page size="A4" style={mapStyle(style)} wrap>
      {children}
    </Page>
  ),
  // Only forward pagination props that are actually set: an explicit
  // `wrap={undefined}` makes react-pdf treat the view as unbreakable.
  View: ({ style, children, wrap, minPresenceAhead }) => {
    const props = {};
    if (wrap !== undefined) props.wrap = wrap;
    if (minPresenceAhead !== undefined) props.minPresenceAhead = minPresenceAhead;
    return (
      <View style={mapStyle(style)} {...props}>
        {children}
      </View>
    );
  },
  Text: ({ style, children }) => <Text style={mapStyle(style)}>{children}</Text>,
  Span: ({ style, children }) => <Text style={mapStyle(style)}>{children}</Text>,
  // Vector icon (no raster images), stroked like the Lucide originals.
  Icon: ({ name, size, color, style }) => (
    <Svg viewBox="0 0 24 24" width={size} height={size} style={style}>
      {(CONTACT_ICONS[name] || []).map(([tag, attrs], i) => {
        const El = SVG_ELEMENTS[tag];
        return (
          <El key={i} {...attrs} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        );
      })}
    </Svg>
  ),
  Link: ({ src, style, children }) => (
    <Link src={src} style={mapStyle(style)}>
      {children}
    </Link>
  ),
};

export const renderCvPdfBlob = async ({ title, data, settings, template }) => {
  const doc = (
    <Document title={title || data.personal?.fullName || 'CV'} author={data.personal?.fullName || ''} creator="Muqayyim" producer="Muqayyim">
      <CvDocument P={pdfPrimitives} data={data} settings={settings} template={template} />
    </Document>
  );
  return pdf(doc).toBlob();
};

export const downloadCvPdf = async (cv) => {
  const blob = await renderCvPdfBlob(cv);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameFor(cv.title || cv.data.personal?.fullName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};
