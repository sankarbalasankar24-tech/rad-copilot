// units.js — deterministic parsing helpers for numbers, measurements, units and
// anatomical segment/level notation. Pure ES module: importable in Node tests
// and in the browser (Chrome extension side panel) identically.

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  half: 0.5, quarter: 0.25,
};

const NUMBER_WORDS_KEYS = Object.keys(NUMBER_WORDS).join('|');

const NUMBER_CAPTURE =
  `(?:(\\d+(?:\\.\\d+)?)|((?:${NUMBER_WORDS_KEYS})(?:[-\\s]+(?:${NUMBER_WORDS_KEYS}))*))`;

const UNIT_CAPTURE =
  'millimeters?|millimetres?|millimeter|millimetre|mm|centimeters?|centimetres?|centimeter|centimetre|cm';

const MEASURE_RE = new RegExp(
  `\\b${NUMBER_CAPTURE}\\s*[-\\s]?\\s*(${UNIT_CAPTURE})\\b`,
  'i',
);

const SEGMENT_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const ROMAN_SEGMENTS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export function wordsToNumber(text) {
  if (text == null) return null;
  const t = String(text).toLowerCase().trim();
  if (!t) return null;
  if (/^\d+(?:\.\d+)?$/.test(t)) return parseFloat(t);
  const tokens = t.split(/[\s-]+/).filter(Boolean);
  if (!tokens.length) return null;
  let sum = 0;
  for (const tok of tokens) {
    if (!(tok in NUMBER_WORDS)) return null;
    sum += NUMBER_WORDS[tok];
  }
  return sum;
}

/** Parse "5 mm", "five-millimetre", "two cm", "1.5 cm" etc. -> { value, unit, raw } | null */
export function parseMeasure(text) {
  if (!text) return null;
  const m = MEASURE_RE.exec(String(text));
  if (!m) return null;
  const value = m[1] != null ? parseFloat(m[1]) : wordsToNumber(m[2]);
  if (value == null || Number.isNaN(value)) return null;
  const unitRaw = (m[3] || '').toLowerCase();
  const unit = unitRaw.startsWith('c') || unitRaw.startsWith('cent') ? 'cm' : 'mm';
  return { value, unit, raw: m[0] };
}

/** Canonical display: "5 mm", "1.5 cm" */
export function measurePhrase(measure) {
  if (!measure || measure.value == null) return '';
  const value = Number.isInteger(measure.value) ? String(measure.value) : String(measure.value);
  return `${value} ${measure.unit}`;
}

/** Convert cm -> mm numeric value (no rounding beyond float precision) */
export function toMm(measure) {
  if (!measure) return null;
  return measure.unit === 'cm' ? measure.value * 10 : measure.value;
}

/** liver segment words/digits -> roman numeral I..VIII */
export function romanSegment(wordOrNum) {
  if (wordOrNum == null) return null;
  const t = String(wordOrNum).toLowerCase().trim();
  if (/^[ivx]+$/i.test(t)) {
    const idx = ROMAN_SEGMENTS.findIndex((r) => r.toLowerCase() === t);
    return idx >= 0 ? ROMAN_SEGMENTS[idx] : null;
  }
  let n = null;
  if (/^\d+$/.test(t)) n = parseInt(t, 10);
  else {
    const i = SEGMENT_WORDS.indexOf(t);
    if (i >= 0) n = i + 1;
  }
  if (n == null || n < 1 || n > 8) return null;
  return ROMAN_SEGMENTS[n - 1];
}

/** Parse a spine/vertebral level mention like "L4-L5", "T12 L1", "l5", "C5-6" */
export function parseSpineLevel(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const m = t.match(/\b(?:l|c|t)\s*(\d{1,2})(?:\s*[-–to]+\s*(?:l|c|t)?\s*(\d{1,2}))?\b/)
    || t.match(/\b(?:lumbar|cervical|thoracic|dorsal)\s+(\d{1,2})(?:\s*[-–to]+\s*(?:l|c|t)?\s*(\d{1,2}))?\b/);
  if (!m) return null;
  const levelWord = (m[0].match(/\b(?:l|c|t)\d|\b(?:lumbar|cervical|thoracic|dorsal)/) || [''])[0];
  const region = /^\s*(c|cervical)/i.test(levelWord) ? 'C'
    : /^\s*(t|thoracic|dorsal)/i.test(levelWord) ? 'T' : 'L';
  const a = `${region}${m[1]}`;
  const b = m[2] ? `${(/^(\d)/.test(m[2]) ? '' : region)}${m[2]}` : null;
  const display = b ? `${a}-${b}` : a;
  return { upper: a, lower: b, display };
}
