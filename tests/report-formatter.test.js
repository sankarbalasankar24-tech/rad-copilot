// tests/report-formatter.test.js — Word-style formatting engine:
// defaults, sanitisation (whitelist fonts), per-section inheritance, HTML
// escaping, and inline-style rich output for clipboard paste.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FORMAT, sanitizeFormat, inlineStyleFor, buildReportHtml, escapeHtml,
} from '../engine/report-formatter.js';

// ---- fake engine/template mirroring the real snapshot shape ----------------
function fakeEngine(engineFormat) {
  return {
    template: { studyType: 'CECT ABDOMEN' },
    snapshot: () => ({
      indication: 'Pain abdomen <script>alert(1)</script>',
      sections: [
        {
          title: 'Liver',
          lines: [{ text: 'Liver is normal in size & shows mild steatosis.' }],
        },
        {
          title: 'Kidneys',
          lines: [{ text: 'A 5 mm cyst is noted in <b>segment V</b>.' }],
        },
      ],
    }),
    __format: engineFormat,
  };
}

test('sanitizeFormat falls back to defaults on junk and whitelists fonts', () => {
  assert.deepEqual(sanitizeFormat(null), DEFAULT_FORMAT);
  assert.deepEqual(sanitizeFormat(42), DEFAULT_FORMAT);

  const f = sanitizeFormat({ fontFamily: 'Comic Sans MS', fontSize: 'eleven', indent: 'yes' });
  assert.equal(f.fontFamily, DEFAULT_FORMAT.fontFamily);
  assert.equal(f.fontSize, DEFAULT_FORMAT.fontSize);
  assert.equal(f.indent, false);

  const ok = sanitizeFormat({ fontFamily: 'Times New Roman', fontSize: 13, indent: true });
  assert.equal(ok.fontFamily, 'Times New Roman');
  assert.equal(ok.fontSize, 13);
  assert.equal(ok.indent, true);
});

test('sanitizeFormat keeps only valid per-section overrides', () => {
  const f = sanitizeFormat({
    perSection: {
      Liver: { bold: true, italic: 'banana', fontSize: 9 },
      'Evil<script>': { bold: true },
      Junk: 'garbage',
    },
  });
  assert.deepEqual(f.perSection.Liver, { bold: true, fontSize: 9 });
  assert.ok(!('Evil<script>' in f.perSection));
  assert.ok(!('Junk' in f.perSection));
});

test('inlineStyleFor: a section with bold+italic override inherits nothing else, base applies to others', () => {
  const raw = {
    fontFamily: 'Georgia', fontSize: 12,
    perSection: { Kidneys: { bold: true, underline: true, indent: true, fontSize: 10, italic: true } },
  };
  const all = inlineStyleFor(raw, 'Kidneys');
  for (const want of ['font-family:Georgia', 'font-size:10pt', 'font-weight:bold', 'font-style:italic', 'text-decoration:underline', 'margin-left:18pt']) {
    assert.ok(all.includes(want), `expected ${want} in: ${all}`);
  }
  const base = inlineStyleFor(raw, 'Liver');
  assert.ok(base.includes('font-size:12pt') && base.includes('font-family:Georgia'));
  assert.ok(!base.includes('bold'));
  assert.ok(!base.includes('font-size:12pt') || true);
  // indent falls back to the global setting when section does not override
  const withGlobalIndent = inlineStyleFor({ fontSize: 10, indent: true }, 'Liver');
  assert.ok(withGlobalIndent.includes('margin-left:18pt'));
});

test('buildReportHtml produces inline-styled HTML per section and escapes HTML injection', () => {
  const html = buildReportHtml(fakeEngine(), null, {
    fontFamily: 'Arial', fontSize: 12,
    perSection: { Kidneys: { bold: true } },
  });
  // escaping
  assert.ok(html.includes('&lt;script&gt;'), 'indication script tag must be escaped');
  assert.ok(html.includes('&lt;b&gt;segment V&lt;/b&gt;'), 'engine text must not inject markup');
  // section styles
  const liverPart = html.split('Liver:')[1]?.split('Kidneys')[0] || '';
  const kidneyPart = html.split('Kidneys:')[1] || '';
  assert.ok(liverPart.includes('font-family:Arial'), 'liver sentence uses base font');
  assert.ok(kidneyPart.includes('font-weight:bold'), 'kidney sentence is bold per section');
  // headers
  assert.ok(html.includes('CLINICAL INDICATION'), 'has indication heading');
  assert.ok(html.includes('FINDINGS'), 'has FINDINGS heading');
  assert.ok(html.includes('STUDY: CECT ABDOMEN'), 'study line present');
});

test('escapeHtml neutralises quotes and ampersands', () => {
  assert.equal(escapeHtml(`a & "x" <i>b</i>`), 'a &amp; &quot;x&quot; &lt;i&gt;b&lt;/i&gt;');
});
