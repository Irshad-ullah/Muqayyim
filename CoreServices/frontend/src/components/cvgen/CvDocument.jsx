import React from 'react';
import {
  ACCENT_COLORS,
  FONT_SCALES,
  SECTION_LABELS,
  displayUrl,
  formatDate,
  formatRange,
  hrefUrl,
  resolveAccent,
  toBullets,
  visibleSections,
} from './cvModel.js';
import { TEMPLATE_STYLES, TEXT_COLOR, MUTED_COLOR, RULE_COLOR } from './templates.js';

// Module 4 — the single CV layout used for both the live HTML preview and the
// PDF export. It renders through a set of primitives `P` ({ Page, View, Text,
// Span, Link }) so the same tree can target the DOM or @react-pdf/renderer.
//
// ATS rules applied here: one column, real text only (no icons, bars, charts
// or images), standard section headings, consistent dates and bullets.

export default function CvDocument({ P, data, settings, template }) {
  const t = TEMPLATE_STYLES[template] || TEMPLATE_STYLES.classic;
  const k = FONT_SCALES[settings.fontSize] || 1;
  const accent = ACCENT_COLORS[resolveAccent(settings.accentColor)];
  const sz = (n) => Math.round(n * k * 10) / 10;
  const color = (c) => (c === 'accent' ? accent : TEXT_COLOR);

  const s = {
    page: {
      fontFamily: settings.fontFamily === 'serif' ? 'serif' : 'sans',
      fontSize: sz(t.bodySize),
      lineHeight: t.lineHeight,
      color: TEXT_COLOR,
      paddingTop: t.pagePadding.top,
      paddingRight: t.pagePadding.right,
      paddingBottom: t.pagePadding.bottom,
      paddingLeft: t.pagePadding.left,
    },
    header: { marginBottom: t.sectionGap, alignItems: t.headerAlign === 'center' ? 'center' : 'flex-start' },
    name: { fontSize: sz(t.nameSize), fontWeight: 'bold', color: color(t.nameColor), lineHeight: 1.15, textAlign: t.headerAlign },
    headline: { fontSize: sz(t.headlineSize), color: MUTED_COLOR, marginTop: 2, textAlign: t.headerAlign },
    contactRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: t.headerAlign === 'center' ? 'center' : 'flex-start',
      marginTop: 5,
    },
    contactItem: { flexDirection: 'row', alignItems: 'center', marginRight: 10, marginBottom: 2 },
    contactIcon: { marginRight: 3 },
    contactText: { fontSize: sz(t.contactSize), color: MUTED_COLOR, lineHeight: 1.2 },
    section: { marginBottom: t.sectionGap },
    heading: {
      fontSize: sz(t.headingSize),
      fontWeight: 'bold',
      color: color(t.headingColor),
      letterSpacing: t.headingUppercase ? 0.8 : 0,
      paddingBottom: 2,
      marginBottom: 5,
      borderBottomWidth: t.headingRule === 'full' ? 0.75 : 0,
      borderBottomColor: t.headingColor === 'accent' ? accent : RULE_COLOR,
      borderBottomStyle: 'solid',
    },
    entry: { marginBottom: t.entryGap },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    rowMain: { flexGrow: 1, flexShrink: 1, paddingRight: 8 },
    title: { fontWeight: 'bold' },
    org: { color: MUTED_COLOR },
    dates: { color: MUTED_COLOR, flexShrink: 0, textAlign: 'right' },
    para: { marginTop: 2 },
    bulletRow: { flexDirection: 'row', marginTop: 1.5 },
    bulletMark: { width: 10, flexShrink: 0 },
    bulletText: { flexGrow: 1, flexShrink: 1 },
    meta: { color: MUTED_COLOR, marginTop: 1 },
    skillLine: { marginBottom: 2 },
  };

  const heading = (key) => {
    const label = SECTION_LABELS[key];
    return (
      <P.View style={s.heading} minPresenceAhead={36}>
        <P.Text>{t.headingUppercase ? label.toUpperCase() : label}</P.Text>
      </P.View>
    );
  };

  const description = (text) => {
    const { bullets, paragraph } = toBullets(text);
    if (paragraph) return <P.Text style={s.para}>{paragraph}</P.Text>;
    return bullets.map((b, i) => (
      <P.View key={i} style={s.bulletRow} wrap={false}>
        <P.Text style={s.bulletMark}>•</P.Text>
        <P.Text style={s.bulletText}>{b}</P.Text>
      </P.View>
    ));
  };

  // Title/organisation line(s) with the date range right-aligned.
  const entryHeader = (title, org, dates) => {
    if (t.entryLayout === 'inline') {
      return (
        <P.View style={s.row} minPresenceAhead={14}>
          <P.Text style={s.rowMain}>
            <P.Span style={s.title}>{title}</P.Span>
            {title && org ? <P.Span style={s.org}>{', '}{org}</P.Span> : !title && org ? <P.Span style={s.title}>{org}</P.Span> : null}
          </P.Text>
          {dates ? <P.Text style={s.dates}>{dates}</P.Text> : null}
        </P.View>
      );
    }
    return (
      <P.View minPresenceAhead={14}>
        <P.View style={s.row}>
          <P.Text style={{ ...s.rowMain, ...s.title }}>{title || org}</P.Text>
          {dates ? <P.Text style={s.dates}>{dates}</P.Text> : null}
        </P.View>
        {title && org ? <P.Text style={s.org}>{org}</P.Text> : null}
      </P.View>
    );
  };

  const join = (...parts) => parts.filter((x) => x && String(x).trim()).join(' · ');

  const sections = {
    summary: () => <P.Text>{data.summary}</P.Text>,

    skills: () => {
      const groups = data.skills.filter((g) => g.items?.length);
      if (!settings.groupSkills) {
        return <P.Text>{groups.flatMap((g) => g.items).join(', ')}</P.Text>;
      }
      return groups.map((g) => (
        <P.Text key={g.id} style={s.skillLine}>
          {g.category ? <P.Span style={s.title}>{g.category}: </P.Span> : null}
          {g.items.join(', ')}
        </P.Text>
      ));
    },

    experience: () =>
      data.experience.map((e) => (
        <P.View key={e.id} style={s.entry}>
          {entryHeader(e.title, join(e.company, e.location), formatRange(e.startDate, e.endDate, e.current))}
          {description(e.description)}
        </P.View>
      )),

    projects: () =>
      data.projects.map((p) => {
        const links = [p.url, p.liveUrl].filter(Boolean);
        return (
          <P.View key={p.id} style={s.entry}>
            {entryHeader(p.name, '', '')}
            {links.length ? (
              <P.Text style={s.meta}>
                {links.map((u, i) => (
                  <React.Fragment key={u}>
                    {i > 0 ? ' | ' : ''}
                    <P.Link src={hrefUrl(u)} style={{ color: MUTED_COLOR, textDecoration: 'none' }}>
                      {displayUrl(u)}
                    </P.Link>
                  </React.Fragment>
                ))}
              </P.Text>
            ) : null}
            {p.technologies?.length ? (
              <P.Text style={s.meta}>
                <P.Span style={s.title}>Technologies: </P.Span>
                {p.technologies.join(', ')}
              </P.Text>
            ) : null}
            {description(p.description)}
          </P.View>
        );
      }),

    education: () =>
      data.education.map((e) => {
        const degree = [e.degree, e.field].filter(Boolean).join(', ');
        return (
          <P.View key={e.id} style={s.entry}>
            {entryHeader(degree, join(e.institution, e.location), formatRange(e.startDate, e.endDate, false))}
            {e.gpa ? <P.Text style={s.meta}>GPA: {e.gpa}</P.Text> : null}
            {e.details ? description(e.details) : null}
          </P.View>
        );
      }),

    certifications: () =>
      data.certifications.map((c) => (
        <P.View key={c.id} style={{ ...s.row, marginBottom: 3 }} wrap={false}>
          <P.Text style={s.rowMain}>
            <P.Span style={s.title}>{c.name}</P.Span>
            {c.issuer ? <P.Span style={s.org}> — {c.issuer}</P.Span> : null}
            {c.url ? (
              <P.Span style={s.org}>
                {' | '}
                <P.Link src={hrefUrl(c.url)} style={{ color: MUTED_COLOR, textDecoration: 'none' }}>
                  {displayUrl(c.url)}
                </P.Link>
              </P.Span>
            ) : null}
          </P.Text>
          {c.date ? <P.Text style={s.dates}>{formatDate(c.date)}</P.Text> : null}
        </P.View>
      )),
  };

  const pi = data.personal || {};
  const contacts = [
    pi.email && { icon: 'email', text: pi.email, href: `mailto:${pi.email}` },
    pi.phone && { icon: 'phone', text: pi.phone },
    pi.location && { icon: 'location', text: pi.location },
    pi.linkedin && { icon: 'linkedin', text: displayUrl(pi.linkedin), href: hrefUrl(pi.linkedin) },
    pi.github && { icon: 'github', text: displayUrl(pi.github), href: hrefUrl(pi.github) },
    pi.website && { icon: 'website', text: displayUrl(pi.website), href: hrefUrl(pi.website) },
  ].filter(Boolean);
  const iconSize = sz(t.contactSize) + 0.5;

  return (
    <P.Page style={s.page}>
      <P.View style={s.header}>
        <P.Text style={s.name}>{pi.fullName}</P.Text>
        {pi.headline ? <P.Text style={s.headline}>{pi.headline}</P.Text> : null}
        {contacts.length ? (
          // Each item: decorative vector icon + real text (the text alone carries the information).
          <P.View style={s.contactRow}>
            {contacts.map((c) => (
              <P.View key={c.icon} style={s.contactItem}>
                <P.Icon name={c.icon} size={iconSize} color={accent} style={s.contactIcon} />
                {c.href ? (
                  <P.Link src={c.href} style={{ ...s.contactText, textDecoration: 'none' }}>
                    {c.text}
                  </P.Link>
                ) : (
                  <P.Text style={s.contactText}>{c.text}</P.Text>
                )}
              </P.View>
            ))}
          </P.View>
        ) : null}
      </P.View>

      {visibleSections(data, settings).map((key) => (
        <P.View key={key} style={s.section}>
          {heading(key)}
          {sections[key]()}
        </P.View>
      ))}
    </P.Page>
  );
}
