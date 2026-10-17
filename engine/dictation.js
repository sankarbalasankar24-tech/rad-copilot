// dictation.js — parses a single dictated fragment into a structured payload:
// commands (correction / retraction / affirm-normal) or a clinical finding with
// laterality, severity, measurement, location, phase and residual qualifiers.
// Ambiguities are surfaced, never silently resolved.

import {
  matchPhrases, escapeRegex, resolveOrgan, detectLaterality, detectSeverity,
  detectPhase, detectNegation, detectLocation, NEGATION_WORDS, STOPWORDS, ORGANS,
  SEVERITY_WORDS,
} from './anatomy.js';
import { parseMeasure, measurePhrase, romanSegment, parseSpineLevel } from './units.js';

const CORRECTION_RE = /^(?:change|revise|amend|update|correct|replace)\s+(?:the\s+)?(?:finding\s+)?(?:of\s+)?(.+?)\s+(?:to|into)\s+(.+)$/;
const RETRACTION_RE = /^(?:remove|delete|take\s+out|take\s+back|forget|retract|withdraw|no longer)\s+(?:the\s+)?(?:finding\s+)?(?:of\s+)?(.+)$/;

// Words that never become qualifiers because they are structural.
const FUNCTION_WORDS = new Set([...STOPWORDS, 'segment', 'lobes', 'lobe', 'pole', 'measuring',
  'measures', 'about', 'approximately', 'around', 'size', 'of']);

function normalizeText(text) {
  let t = String(text || '').toLowerCase();
  t = t.replace(/[’'’]/g, "'").replace(/["“”]/g, ' ');
  // common dictated abbreviations
  t = t.replace(/\bb\/l\b/g, 'bilateral');
  t = t.replace(/\brt\b/g, 'right');
  t = t.replace(/\blt\b/g, 'left');
  t = t.replace(/\br\/l\b/g, 'both');
  t = t.replace(/\b(?:right\s*(?:and|&|plus|with|,)\s*left|left\s*(?:and|&|plus|with|,)\s*right)\b/g, 'bilateral');
  // punctuation -> spaces (preserve digits, letters, hyphen, slash handled above)
  t = t.replace(/[^a-z0-9\- ]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function splitFragments(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  // split at sentence enders, commas, semicolons
  const rough = t.split(/(?<=[.?!;,])\s+/).filter(Boolean);
  const frags = [];
  for (const part of rough) {
    const clean = part.replace(/[.!;,]+$/, '').trim();
    if (clean) frags.push(clean);
  }
  return frags;
}

/** Remove spans of known token groups; leftover contiguous words = qualifiers. */
function extractQualifiers(norm, consumedPhrases) {
  const tokens = norm.split(' ').filter(Boolean);
  var tokenConsumed = new Array(tokens.length).fill(false);
  const consume = (phrase) => {
    if (!phrase) return;
    const re = new RegExp(`(?:^| )${escapeRegex(phrase).replace(/[\s-]+/g, '[ -]')}(?= |$)`, 'i');
    const m = re.exec(norm);
    if (!m) return;
    const subTokens = m[0].trim().split(' ').filter(Boolean);
    // naive: mark tokens by scanning for phrase tokens in order
    let ti = 0;
    for (let i = 0; i < tokens.length && ti < subTokens.length; i++) {
      if (tokens[i] === subTokens[ti]) {
        tokenConsumed[i] = true;
        ti++;
      }
    }
  };
  for (const p of consumedPhrases) consume(p);

  const runs = [];
  let run = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!tokenConsumed[i]) {
      if (!FUNCTION_WORDS.has(tokens[i])) run.push(tokens[i]);
      else if (run.length) { runs.push(run.join(' ')); run = []; }
    } else if (run.length) { runs.push(run.join(' ')); run = []; }
  }
  if (run.length) runs.push(run.join(' '));
  return runs.filter(Boolean).join(' ');
}

export function parseFragment(rawText) {
  const normalized = normalizeText(rawText);
  if (!normalized) return null;

  // 1) command: correction
  let m = CORRECTION_RE.exec(normalized);
  if (m) {
    return {
      kind: 'correction',
      rawText,
      normalized,
      targetPhrase: m[1].trim(),
      newPhrase: m[2].trim(),
    };
  }

  // 2) command: retraction
  m = RETRACTION_RE.exec(normalized);
  if (m) {
    return { kind: 'retraction', rawText, normalized, targetPhrase: m[1].trim() };
  }

  // 3) finding / statement
  const consumed = [];
  const measure = parseMeasure(normalized);
  if (measure) consumed.push(measure.raw);

  const severity = detectSeverity(normalized);
  if (severity) {
    const severityWord = matchPhrases(normalized, SEVERITY_WORDS[severity])[0];
    if (severityWord) consumed.push(severityWord);
  }

  const laterality = detectLaterality(normalized);
  if (laterality && laterality !== 'bilateral') consumed.push(laterality);
  else if (laterality === 'bilateral') {
    // consume whichever bilateral word form matched
    const hit = matchPhrases(normalized, ['bilateral', 'both', 'b/l', 'bilaterally']);
    if (hit[0]) consumed.push(hit[0]);
  }

  const phase = detectPhase(normalized);
  if (phase) consumed.push(String(phase));

  const location = detectLocation(normalized);
  if (location) consumed.push(location.phrase);

  const organ = resolveOrgan(normalized);
  if (organ) {
    for (const syn of ORGANS[organ].synonyms) {
      if (matchPhrases(normalized, [syn]).length) consumed.push(syn);
    }
  }

  const segMatch = /segment\s+(one|two|three|four|five|six|seven|eight|\d+)(?:\s*$|\s)/.exec(normalized);
  const liverSegment = segMatch ? romanSegment(segMatch[1]) : null;
  if (segMatch) consumed.push(segMatch[0].trim());

  const spine = parseSpineLevel(normalized);
  if (spine) consumed.push(spine.display);

  const hasNegation = detectNegation(normalized) != null;

  return {
    kind: 'finding',
    rawText,
    normalized,
    severity,
    laterality,
    measure,
    measurePhraseStr: measure ? measurePhrase(measure) : null,
    phase,
    organ,
    location,
    liverSegment,
    spine,
    hasNegation,
    qualifierText: null, // filled in by template-engine after rule matching
    consumedPhrases: consumed,
  };
}

/** Split a continuous dictation utterance into parsed fragments. */
export function parseUtterance(text) {
  const fragments = splitFragments(text);
  const out = [];
  for (const f of fragments) {
    const parsed = parseFragment(f);
    if (parsed) out.push(parsed);
  }
  return out;
}

export { extractQualifiers, normalizeText, splitFragments };
