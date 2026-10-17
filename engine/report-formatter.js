// engine/report-formatter.js — Word-style formatting for the copy-pasted
// report. Formatting is defined ONCE per section (font, size, bold, italics,
// underline, indent) and every sentence produced later in that section —
// including newly-dictated findings — automatically inherits it, because the
// style is applied at render/copy time from the section, never at edit time.
//
// Output is inline-CSS HTML: hospital reporting software and Wordprocessors
// strip classes but reliably keep inline styles on paste (same mechanism Word
// itself uses when copying).

const FONT_WHITELIST = new Set([
  'Segoe UI', 'Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Verdana',
  'Tahoma', 'Trebuchet MS', 'Cambria', 'Consolas', 'Helvetica', 'SimSun',
]);

export const DEFAULT_FORMAT = {
  fontFamily: 'Segoe UI',
  fontSize: 11,               // points, like Word
  indent: false,              // indent every sentence 1 level
  perSection: {},             // "<section title>": { fontFamily?, fontSize?, bold?, italic?, underline?, indent? }
};

/** deep-clean/normalise user- or stored-format data; never throws */
export function sanitizeFormat(raw) {
  const fmt = { ...DEFAULT_FORMAT, indent: false, perSection: {} };
  if (!raw || typeof raw !== 'object') return fmt;

  if (typeof raw.fontFamily === 'string' && FONT_WHITELIST.has(raw.fontFamily)) {
    fmt.fontFamily = raw.fontFamily;
  }
  const size = Number(raw.fontSize);
  if (Number.isFinite(size) && size >= 7 && size <= 20) fmt.fontSize = size;
  if (typeof raw.indent === 'boolean') fmt.indent = raw.indent;

  if (raw.perSection && typeof raw.perSection === 'object') {
    // keys are section titles — accept only safe ones so a hostile template
    // can't smuggle attribute/HTML syntax through the key
    const KEY_OK = /^[A-Za-z0-9 _&(),"()/\-]{1,80}$/;
    for (const [title, override] of Object.entries(raw.perSection)) {
      if (!override || typeof override !== 'object') continue;
      if (!KEY_OK.test(String(title))) continue;
      const o = {};
      if (typeof override.fontFamily === 'string' && FONT_WHITELIST.has(override.fontFamily)) o.fontFamily = override.fontFamily;
      const os = Number(override.fontSize);
      if (Number.isFinite(os) && os >= 7 && os <= 20) o.fontSize = os;
      for (const k of ['bold', 'italic', 'underline', 'indent']) {
        if (typeof override[k] === 'boolean') o[k] = override[k];
      }
      if (Object.keys(o).length) fmt.perSection[String(title).slice(0, 80)] = o;
    }
  }
  return fmt;
}

/** public helper for the panel UI: inline CSS for a sentence in a section */
export function inlineStyleFor(formatRaw, sectionTitle) {
  return styleFor(sanitizeFormat(formatRaw), sectionTitle);
}

function styleFor(fmt, sectionTitle) {
  const o = (sectionTitle && fmt.perSection[sectionTitle]) || {};
  const family = o.fontFamily || fmt.fontFamily;
  const size = o.fontSize || fmt.fontSize;
  const indent = typeof o.indent === 'boolean' ? o.indent : fmt.indent;
  const esc = (s) => String(s).replace(/"/g, '&quot;').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const parts = [`font-family:${esc(family)}, sans-serif`, `font-size:${size}pt`];
  if (o.bold) parts.push('font-weight:bold');
  if (o.italic) parts.push('font-style:italic');
  if (o.underline) parts.push('text-decoration:underline');
  if (indent) parts.push('margin-left:18pt');
  return parts.join(';');
}

/** escape text for safe embedding in HTML */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Build the rich-text (HTML) report string from an engine snapshot + impression.
 * Every element carries inline styles so the destination editor (Word, an
 * RIS/PACS text field) preserves them on paste.
 */
export function buildReportHtml(engine, impression, formatRaw) {
  const fmt = sanitizeFormat(formatRaw);
  const snap = engine.snapshot();
  const esc = escapeHtml;

  const title = (label, base = false) => {
    const headingStyle = base
      ? `${styleFor(fmt, null)};font-weight:bold;text-transform:uppercase;font-size:${Math.max(fmt.fontSize, 9)}pt;color:#444444;margin:8pt 0 2pt`
      : `${styleFor(fmt, null)};font-weight:bold`;
    return `<p style="${headingStyle}"><span style="letter-spacing:0.4px">${label}</span></p>`;
  };

  const chunks = [];
  const baseStyle = styleFor(fmt, null);

  chunks.push(`<div style="color:#111111">`);
  if (snap.indication) {
    chunks.push(title('CLINICAL INDICATION', true));
    chunks.push(`<p style="${baseStyle}">${esc(snap.indication)}</p>`);
  }
  const studyLine = engine.template.studyType
    ? `STUDY: ${esc(engine.template.studyType)}` : null;
  if (studyLine)  chunks.push(`<p style="${styleFor(fmt, null)};font-weight:bold">${studyLine}</p>`);
  

  chunks.push(title('FINDINGS', true));
  for (const section of snap.sections) {
    chunks.push(title(`${esc(section.title)}:`));
    for (const line of section.lines) {
      // per-section format → every sentence in the section inherits it,
      // including ones added later by dictation
      chunks.push(`<p style="${styleFor(fmt, section.title)}">${esc(line.text)}</p>`);
    }
  }

  if (impression) {
    const impStyle = styleFor(fmt, null);
    chunks.push(title(esc(impression.heading || 'IMPRESSION'), true));
    impression.lines.forEach((l, i) => {
      chunks.push(`<p style="${impStyle}">${i + 1}. ${esc(l.text)}</p>`);
    });
    for (const n of impression.notes) {
      chunks.push(`<p style="${impStyle}margin-left:18pt">- ${esc(n.text)}</p>`);
    }
  }
  chunks.push('</div>');
  return chunks.filter(Boolean).join('\n');
}
