// tests/medical-vocab.test.js — verification of the ASR vocabulary adaptation
// layer against realistic mis-transcriptions.

import test from 'node:test';
import assert from 'node:assert/strict';

import { correctMedicalTerms, MEDICAL_LEXICON } from '../engine/medical-vocab.js';

test('corrects jargon the ASR commonly mis-hears', () => {
  const r = correctMedicalTerms('perinefric fat schlanding is mild');
  assert.equal(r.text.includes('perinephric'), true);
});

test('repairs the classic disc/desk and prostrate traps', () => {
  assert.equal(correctMedicalTerms('desk bulge at L4-L5').text.includes('disc bulge'), true);
  assert.equal(correctMedicalTerms('prostrate gland').text.includes('prostate'), true);
});

test('letter-acronym style terms are restored to canonical', () => {
  const r = correctMedicalTerms('mild perinephric stranding with ihbr and hdn');
  assert.ok(r.text.includes('ihbrd') || r.text.includes('hydronephrosis'));
});

test('administrator-natural language is left untouched', () => {
  const before = 'both kidneys show mild standing of the fat around them';
  const r = correctMedicalTerms(before);
  // 'standing' is a guarded everyday word — must NOT be rewritten
  assert.equal(r.text, before);
  assert.equal(r.corrections.length, 0);
});

test('fuzzy repair flags corrections for the review trail', () => {
  const corrections = [];
  correctMedicalTerms('spline is normal', { onCorrection: (c) => corrections.push(c) });
  assert.ok(corrections.some((c) => c.to === 'spleen'));
});

test('anchor in personal vocabulary drives speaker adaptation', () => {
  const r = correctMedicalTerms('perinefric fat stranding', { customVocab: ['perinephric'] });
  assert.equal(r.text.includes('perinephric'), true);
});

test('numbers and measurements are never distured', () => {
  const before = 'five millimetre simple cyst plus 7 mm calculus';
  const r = correctMedicalTerms(before);
  assert.equal(r.text.includes('five millimetre'), true);
  assert.equal(r.text.includes('7 mm'), true);
});

test('lexicon ships with core radiology groups', () => {
  for (const needed of ['ihbrd', 'perinephric', 'hydronephrosis', 'steatosis' , 'disc bulge']) {
    assert.ok(needed in MEDICAL_LEXICON, `missing ${needed}`);
  }
});
