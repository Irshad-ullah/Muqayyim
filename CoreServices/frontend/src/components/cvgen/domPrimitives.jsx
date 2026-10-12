import React from 'react';
import { CONTACT_ICONS } from './icons.js';

// Module 4 — DOM implementation of the CV primitives used by CvDocument.
// Template styles are written in PDF points; they are converted to CSS pixels
// here so the HTML preview matches the PDF layout.

const PT = 96 / 72;
const UNITLESS = new Set(['fontWeight', 'lineHeight', 'flexGrow', 'flexShrink', 'flex', 'opacity', 'zIndex']);
export const FONT_STACKS = {
  sans: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
};

const toCss = (style = {}, block = false) => {
  const css = {};
  for (const [key, value] of Object.entries(style)) {
    if (key === 'fontFamily') css.fontFamily = FONT_STACKS[value] || value;
    else if (typeof value === 'number' && !UNITLESS.has(key)) css[key] = `${value * PT}px`;
    else css[key] = value;
  }
  if (block) {
    // react-pdf Views are flex columns by default (Yoga); mirror that.
    css.display = 'flex';
    css.flexDirection = style.flexDirection || 'column';
  }
  return css;
};

export const A4_WIDTH_PX = 595.28 * PT;
export const A4_HEIGHT_PX = 841.89 * PT;

export const domPrimitives = {
  Page: ({ style, children }) => (
    <div style={{ ...toCss(style, true), width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX, boxSizing: 'border-box', background: '#fff' }}>
      {children}
    </div>
  ),
  View: ({ style, children }) => <div style={toCss(style, true)}>{children}</div>,
  Text: ({ style, children }) => (
    <div style={{ ...toCss(style), whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{children}</div>
  ),
  Span: ({ style, children }) => <span style={toCss(style)}>{children}</span>,
  Icon: ({ name, size, color, style }) => (
    <svg
      viewBox="0 0 24 24"
      width={size * PT}
      height={size * PT}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ ...toCss(style), flexShrink: 0 }}
    >
      {(CONTACT_ICONS[name] || []).map(([Tag, attrs], i) => (
        <Tag key={i} {...attrs} />
      ))}
    </svg>
  ),
  Link: ({ src, style, children }) => (
    <a href={src} target="_blank" rel="noreferrer noopener" style={toCss(style)}>
      {children}
    </a>
  ),
};
