// medical-vocab.js — the "Augnito-style" vocabulary adaptation layer, free and
// deterministic. Generic ASR engines (Chrome Web Speech, whisper.cpp, …) miss
// radiology jargon; this post-processor repairs common mis-transcriptions
// before dictation reaches the structured engine. Every substitution is
// reported, so the radiologist can always verify.

import { matchPhrases, escapeRegex } from './anatomy.js';

// canonical -> spoken forms the ASR is known to produce
export const MEDICAL_LEXICON = {
  ihbrd: ['ihbr', 'i h b r d', 'inbhrd', 'ihbrt', 'in hbr d'],
  perinephric: ['peri nephric', 'perinefric', 'peri nefric', 'peri nepric'],
  steatosis: ['steotosis', 'steato sis', 'steatose', 'steototic'],
  hydronephrosis: ['hydro nephrosis', 'hydra nephrosis', 'hydro nephritis', 'hdn'],
  pelvicalyceal: ['pelvi calyceal', 'pelvicalyseal', 'pelvicaliceal', 'pelvicalycial'],
  calculus: ['calculous', 'cal culus'],
  calculi: ['calculies', 'cal cules'],
  appendicitis: ['appendicities', 'appendicitus', 'appendicides'],
  disc: ['desk', 'disk'],
  'disc bulge': ['desk bulge', 'this bulge', 'disc bulk', 'desk bulk'],
  hemorrhage: ['haemorrhage', 'hemerage', 'hemorage', 'haemorhage'],
  infarct: ['infract', 'in farc', 'in far ct'],
  ischemia: ['ischaemia', 'ischemic'],
  ascites: ['a sites', 'as sites', 'assites', 'ascities'],
  spleen: ['spline'],            // 'spline' is the common ASR slip
  prostate: ['prostrate'],       // classic transcription trap
  cholecystitis: ['cholecistitis', 'colocystitis'],
  diverticulosis: ['diverticulitus', 'diverticulitises', 'diverticulitis'] ,
  spondylosis: ['spondalosis', 'spondelosis', 'spondylitic changes'],
  thecal: ['tecal', 'dee cal'],
  mediastinum: ['media stinum', 'mediastinum'],
  diaphragm: ['diafram', 'diaphram'],
  hydroureter: ['hydro ureter', 'hydro urethral', 'hydra ureter'],
  ileum: ['iliam', 'illium'],
  sternum: ['stern um'],
  parenchyma: ['parenchymal', 'parenchema'],
};

// tokens the fuzzy matcher must never touch (they are correct English words
// whose edit distance is close to some medical term)
const FUZZYMATCH_GUARD = new Set([
  ...['the', 'this', 'that', 'with', 'without', 'there', 'their', 'here', 'where',
    'standing', 'strange', 'strain', 'desk', 'disk', 'spline', 'proper', 'state',
    'prostrate', 'cal, unity', 'supreme', 'spleen', 'site', 'sites', 'city',
    'left', 'right', 'both', 'bilateral', 'mild', 'moderate', 'severe', 'minor',
    'major', 'normal', 'repeat', 'report', 'check', 'change', 'remove'],
]);

const STOP_RE = /[^\w-]+/;

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function maxDistance(len) {
  if (len >= 9) return 2;
  if (len >= 6) return 1;
  return 0;
}

function exactPhraseRegex(phrase) {
  const p = escapeRegex(phrase.toLowerCase().trim()).replace(/[\s-]+/g, '[ -]+');
  return new RegExp(`(?:^|\\s)${p}(?=\\s|$)`, 'i');
}

export function defaultLexicon() {
  return MEDICAL_LEXICON;
}

/**
 * Correct one chunk of ASR output.
 * options: { lexicon (object canonical->forms), customVocab (extra canonical strings),
 *            onCorrection({from, to, fuzzy}) }
 */
export function correctMedicalTerms(input, options = {}) {
  if (!input) return { text: input || '', corrections: [] };
  const lex = { ...MEDICAL_LEXICON, ...(options.lexicon || {}) };
  const corrections = [];
  let text = String(input);

  // 0) user-supplied personal words (Augnito-style speaker adaptation)
  for (const custom of options.customVocab || []) {
    const c = String(custom).trim().toLowerCase();
    if (!c) continue;
    const re = exactPhraseRegex(c.replace(/[^a-z0-9 -]/gi, ''));
    if (re.test(text)) continue; // already present/correct — nothing to do
    // custom words map from their closest fuzzy variant found in text
    const tokens = text.toLowerCase().split(STOP_RE).filter(Boolean);
    let best = null;
    for (const tok of tokens) {
      if (tok.length < 4) continue;
      const d = levenshtein(tok, c);
      if (!best || d < best.d) best = { tok, d };
    }
    if (best && best.d <= maxDistance(best.tok.length)) {
      text = text.replace(new RegExp(`\\b${escapeRegex(best.tok)}\\b`, 'i'), c);
      corrections.push({ from: best.tok, to: c, fuzzy: true, custom: true });
      options.onCorrection && options.onCorrection({ from: best.tok, to: c, fuzzy: true, custom: true });
    }
  }

  // 1) exact spoken-form phrases → canonical
  for (const [canonical, forms] of Object.entries(lex)) {
    for (const form of forms || []) {
      const f = String(form).toLowerCase().trim();
      if (!f) continue;
      if (f === canonical) continue;
      const re = exactPhraseRegex(f);
      if (re.test(text)) {
        text = text.replace(new RegExp(`\\b${escapeRegex(f).replace(/[\s-]+/g, '[ -]+')}\\b`, 'i'), canonical);
        corrections.push({ from: form, to: canonical, fuzzy: false });
        options.onCorrection && options.onCorrection({ from: form, to: canonical, fuzzy: false });
      }
    }
  }

  // 2) fuzzy single-token repair (only long, unguarded tokens)
  const tokens = text.split(/\s+/).filter(Boolean);
  const fixed = [];
  for (const tok of tokens) {
    const bare = tok.toLowerCase().replace(/[^\w-]/g, '');
    if (bare.length < 6 || FUZZYMATCH_GUARD.has(bare)) { fixed.push(tok); continue; }
    let replaced = false;
    outer:
    for (const [canonical, forms] of Object.entries(lex)) {
      const key = canonical.toLowerCase().replace(/[^\w-]/g, '');
      if (bare === key) { fixed.push(tok); replaced = true; break outer; }
      for (const form of forms || []) {
        const f = String(form).toLowerCase().replace(/[^\w-]/g, '');
        const d = levenshtein(bare, f);
        if (d <= maxDistance(f.length)) {
          fixed.push(canonical);
          corrections.push({ from: tok, to: canonical, fuzzy: true });
          options.onCorrection && options.onCorrection({ from: tok, to: canonical, fuzzy: true });
          replaced = true;
          break outer;
        }
      }
      // close to the canonical word itself (typical letter slips)
      const d2 = levenshtein(bare, key);
      if (d2 <= maxDistance(key.length)) {
        fixed.push(canonical);
        corrections.push({ from: tok, to: canonical, fuzzy: true });
        options.onCorrection && options.onCorrection({ from: tok, to: canonical, fuzzy: true });
        replaced = true;
        break;
      }
    }  if (!replaced) fixed.push(tok);
    }
  const corrected = fixed.join(' ').replace(/\s+/g, ' ').trim();
  return { text: corrected, corrections };
}
