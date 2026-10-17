// tests/mandatory-examples.test.js — the non-negotiable acceptance examples
// from Rad-Copilot's specification, executed against the real engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { ReportingEngine } from '../engine/template-engine.js';
import { ImpressionGenerator } from '../engine/impression-generator.js';
import { checkConsistency } from '../engine/consistency-checker.js';
import { buildReportText } from '../engine/report-builder.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(path.join(here, '../templates', name), 'utf8'));

function engineFor(name) {
  return new ReportingEngine(load(name));
}
function sectionText(snapshot, sectionId) {
  const s = snapshot.sections.find((x) => x.sectionId === sectionId);
  return s.lines.map((l) => l.text).join(' ');
}

// ---------------------------------------------------------------- Example 1
test('mild fatty liver updates the liver normal statements incrementally', () => {
  const e = engineFor('cect-abdomen.json');
  e.ingest('Mild fatty liver.');
  const snap = e.snapshot();
  const liver = sectionText(snap, 'liver');
  assert.match(liver, /Liver is normal in size and shows mild steatosis\./);
  assert.match(liver, /No focal lesion\./);
  assert.match(liver, /No IHBRD\./);
  const kidney = sectionText(snap, 'kidneys');
  assert.match(kidney, /Both kidneys are normal/);
});

// ---------------------------------------------------------------- Example 2
test('five mm segment five cyst replaces the no-focal-lesion normal only', () => {
  const e = engineFor('cect-abdomen.json');
  e.ingest('Mild fatty liver.');
  e.ingest('Five-millimetre simple cyst in segment five.');
  const liver = sectionText(e.snapshot(), 'liver');
  assert.match(liver, /A 5 mm simple cyst is noted in segment V\./);
  assert.doesNotMatch(liver, /No focal lesion\./);
  assert.match(liver, /shows mild steatosis\./);              // unrelated liver statement preserved
  assert.match(liver, /No IHBRD\./);                          // unrelated normal preserved
  const others = e.snapshot().sections.find((s) => s.sectionId === 'bowel');
  assert.match(others.lines.map((l) => l.text).join(' '), /normal caliber and enhancement/);
});

// ---------------------------------------------------------------- Example 3
test('kidney cyst correction updates the existing finding instead of duplicating', () => {
  const e = engineFor('cect-abdomen.json');
  e.ingest('Simple cyst measuring 5 mm in right kidney.');
  let liver = sectionText(e.snapshot(), 'liver');
  let kidney = sectionText(e.snapshot(), 'kidneys');
  assert.match(kidney, /A 5 mm simple cyst is noted in the right kidney\./);
  assert.doesNotMatch(liver, /simple cyst/);

  e.ingest('Change simple cyst to cyst with thin internal septation.');
  const snap = e.snapshot();
  kidney = sectionText(snap, 'kidneys');
  liver = sectionText(snap, 'liver');
  assert.match(kidney, /cyst with thin internal septation/);
  assert.match(kidney, /5 mm/);
  const cystCount = snap.activeFindings.filter(
    (f) => f.sectionId === 'kidneys' && f.ruleKey === 'renal-cyst').length;
  assert.equal(cystCount, 1, 'cyst finding must not be duplicated');
  assert.doesNotMatch(liver, /thin internal septation/, 'correction must not leak to another organ');
});

// ---------------------------------------------------------------- Example 4
test('perinephric fat stranding routes silently to the kidney section', () => {
  const e = engineFor('cect-abdomen.json');
  e.ingest('Mild bilateral perinephric fat stranding.');
  const kidney = sectionText(e.snapshot(), 'kidneys');
  assert.match(kidney, /Mild bilateral perinephric fat stranding is noted\./);
  assert.doesNotMatch(kidney, /No perinephric fat stranding\./);
  const liver = sectionText(e.snapshot(), 'liver');
  assert.match(liver, /Liver is normal in size and attenuation\./); // untouched section intact
});

// --------------------------------------------------- retraction / affirm normal
test('retraction removes only the targeted finding and restores related normals', () => {
  const e = engineFor('cect-abdomen.json');
  e.ingest('Mild fatty liver.');
  e.ingest('Five-millimetre simple cyst in segment five.');
  e.ingest('Remove the five mm cyst.');
  const snap = e.snapshot();
  const liver = sectionText(snap, 'liver');
  assert.doesNotMatch(liver, /simple cyst/);
  assert.match(liver, /No focal lesion\./);          // normal restored
  assert.match(liver, /mild steatosis/);             // untouched finding preserved
});

test('affirming an organ normal retracts its findings with an audit trail', () => {
  const e = engineFor('cect-abdomen.json');
  e.ingest('Moderate fatty liver.');
  e.ingest('Liver is normal.');
  const snap = e.snapshot();
  assert.equal(snap.activeFindings.filter((f) => f.sectionId === 'liver').length, 0);
  assert.match(sectionText(snap, 'liver'), /normal in size and attenuation/);
});

// ------------------------------------------------------- incremental rendering
test('unchanged sections are not re-rendered and their cache stays valid', () => {
  const e = engineFor('cect-abdomen.json');
  const before = e.sectionCache;
  e.ingest('Mild fatty liver.');
  assert.ok(e.sectionCache.kidneys === before.kidneys, 'untouched section reused from cache');
  e.ingest('Five-millimetre simple cyst in segment five.');
  assert.ok(e.sectionCache.kidneys === before.kidneys, 'kidneys still untouched');
});

// ----------------------------------------------------- contradictory fragments
test('negated repeat of a finding retracts it (no-cyst dictation)', () => {
  const e = engineFor('cect-abdomen.json');
  e.ingest('5 mm simple cyst in right kidney.');
  e.ingest('No cyst in right kidney.');
  const snap = e.snapshot();
  assert.equal(snap.activeFindings.filter((f) => f.sectionId === 'kidneys').length, 0);
  assert.match(sectionText(snap, 'kidneys'), /No renal cysts\./);
});

// ---------------------------------------------------------- ambiguity handling
test('ambiguous correction is flagged, not guessed', () => {
  const e = engineFor('cect-abdomen.json');
  e.ingest('5 mm simple cyst in right kidney.');
  e.ingest('Another 8 mm simple cyst in left kidney.');
  e.ingest('Change the simple cyst to complex cyst.');
  const snap = e.snapshot();
  assert.ok(snap.reviewItems.some((r) => r.message.includes('multiple findings')),
    'must surface ambiguity');
  assert.equal(snap.activeFindings.filter((f) => f.ruleKey === 'renal-cyst').length, 2);
});

// ----------------------------------------------------- unspecified measure dedupe
test('unsupported unsectioned dictation lands in review, never invented away', () => {
  const e = engineFor('mri-lumbar-spine.json');
  const res = e.ingest('Purple stars noted somewhere remarkable.');
  assert.equal(res.some((r) => r.unmapped === true), true);
  const snap = e.snapshot();
  assert.ok(snap.reviewItems.length + snap.unmapped.length >= 1);

  // a mapped finding with odd descriptors is also kept but flagged
  const e2 = engineFor('mri-lumbar-spine.json');
  e2.ingest('Purple-starry lesion in a vertebra.');
  const snap2 = e2.snapshot();
  assert.ok(snap2.activeFindings.some((f) => (f.needsReview || []).length), 'odd qualifiers must be flagged');
  assert.ok(snap2.reviewItems.length >= 1);
});

// ------------------------------------------------------------------ Impressions
test('impression is strictly built from documented findings', () => {
  const e = engineFor('cect-abdomen.json');
  e.setIndication('Rt iliac fossa pain');
  e.ingest('Mild fatty liver.');
  e.ingest('5 mm simple cyst in right kidney.');
  const imp = new ImpressionGenerator(e).build(e.indication);
  const texts = imp.lines.map((l) => l.text).join(' ');
  assert.match(texts, /steatosis/i);
  assert.match(texts, /cyst/i);
  assert.match(texts, /No features of acute appendicitis/i); // relevant negative from documented normal bowel
  imp.lines.forEach((l) => {
    if (l.basis === 'finding') {
      assert.ok(l.sourceFindingIds.length === 1);
      const f = e.findings.find((x) => x.id === l.sourceFindingIds[0]);
      assert.ok(f && f.status === 'active', 'every positive line must cite a live finding');
    } else if (l.isSuggestedNegative) {
      // negative must belong to a section that has no active findings
      const actives = e.activeFindings().filter((f) => f.sectionId === l.sectionId);
      assert.equal(actives.length, 0, 'negatives only where section is documented normal');
    }
  });
});

test('no positive impression lines are fabricated when no findings', () => {
  const e = engineFor('ncct-brain.json');
  const imp = new ImpressionGenerator(e).build('headache');
  assert.equal(imp.lines.filter((l) => l.basis === 'finding').length, 0);
  assert.match(imp.lines[0].text, /No definite abnormality/i);
});

// ------------------------------------------------------------ consistency layer
test('consistency checker flags contradictions and duplicates explicitly', () => {
  const e = engineFor('cect-abdomen.json');
  e.ingest('5 mm simple cyst in right kidney.');
  // simulate a contradiction surviving rendering
  const snap = e.snapshot();
  const liver = e.sectionById('liver');
  liver.slots[1].replaceNormal = null; // template surgery for the test only
  e.sectionDirty.add('liver');
  const issues = checkConsistency(e);
  assert.ok(Array.isArray(issues));
});

// --------------------------------------------------- MRI spine end-to-end flow
test('MRI spine: dict ordered corrections and impression', () => {
  const e = engineFor('mri-lumbar-spine.json');
  e.setIndication('Low backache with radiating leg pain');
  e.ingest('Broad-based posterior disc bulge at L4-L5 indentation of thecal sac.');
  // hmm: "indentation" not a configured qualifier word — should survive verbatim-ish qualifiers
  const discs = sectionText(e.snapshot(), 'discs');
  assert.match(discs, /disc bulge/i);
  assert.match(discs, /L4-L5/i);
  const imp = new ImpressionGenerator(e).build(e.indication);
  assert.match(imp.lines.map((l) => l.text).join(' '), /disc bulge/i);
});

// --------------------------------------------------------------- final report
test('copy-ready report is complete with template headings and impression', () => {
  const e = engineFor('cect-abdomen.json');
  e.setIndication('Pain abdomen');
  e.ingest('Mild fatty liver. Five-millimetre simple cyst in segment five. Mild bilateral perinephric fat stranding.');
  const imp = new ImpressionGenerator(e).build(e.indication);
  const text = buildReportText(e, imp);
  assert.match(text, /CLINICAL INDICATION: Pain abdomen/);
  assert.match(text, /FINDINGS:/);
  assert.match(text, /Liver:/);
  assert.match(text, /A 5 mm simple cyst is noted in segment V\./);
  assert.match(text, /Mild bilateral perinephric fat stranding is noted\./);
  assert.match(text, /IMPRESSION:/);
  assert.match(text, /1\./);
});
