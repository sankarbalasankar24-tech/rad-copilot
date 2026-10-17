// consistency-checker.js — final-review consistency layer over the engine
// snapshot. Produces explicit, human-readable flags; never mutates the report.

export function checkConsistency(engine) {
  const issues = [];
  const snapshot = engine.snapshot();
  const active = snapshot.activeFindings;

  for (const section of snapshot.sections) {
    // 1) duplicated findings that slipped through dedupe
    const seen = new Map();
    for (const f of active.filter((x) => x.sectionId === section.sectionId)) {
      const key = `${f.ruleKey}|${f.laterality}|${f.segmentRoman || ''}|${f.spine?.display || ''}|${f.location?.key || ''}`;
      if (seen.has(key)) {
        issues.push({
          severity: 'error',
          sectionId: section.sectionId,
          message: `Possible duplicate: two "${f.subject}" entries (${seen.get(key).rawDictation} / ${f.rawDictation}).`,
        });
      } else {
        seen.set(key, f);
      }
    }

    // 2) contradictory normal statements still present despite documented findings
    for (const slot of engine.sectionById(section.sectionId)?.slots || []) {
      if (!slot.replaceNormal) continue;
      const hasActive = active.some((f) => f.sectionId === section.sectionId && f.slotKey === slot.id);
      if (!hasActive) continue;
      const stillThere = section.lines.some((l) => l.origin === 'normal'
        && l.text.toLowerCase().includes(String(slot.replaceNormal).toLowerCase()));
      if (stillThere) {
        issues.push({
          severity: 'error',
          sectionId: section.sectionId,
          message: `Contradiction: documented findings exist, but the normal statement "${slot.replaceNormal}" remains in the report.`,
        });
      }
    }

    // 3) verdict/laterality mismatch inside rendered sentences
    for (const f of active.filter((x) => x.sectionId === section.sectionId)) {
      const line = section.lines.find((l) => l.findingId === f.id);
      if (!line) {
        issues.push({ severity: 'warning', sectionId: section.sectionId, message: `Finding "${f.rawDictation}" is not rendered in any sentence.` });
        continue;
      }
      const text = (line.text || '').toLowerCase();
      if (f.laterality === 'left' && text.includes('right')) {
        issues.push({ severity: 'error', sectionId: section.sectionId, message: `Laterality mismatch (left finding): "${line.text}"` });
      }
      if (f.laterality === 'right' && text.includes('left')) {
        issues.push({ severity: 'error', sectionId: section.sectionId, message: `Laterality mismatch (right finding): "${line.text}"` });
      }
      if (f.measure && f.measure.value <= 0) {
        issues.push({ severity: 'error', sectionId: section.sectionId, message: `Non-positive measurement for "${f.rawDictation}".` });
      }
      for (const r of f.needsReview || []) {
        issues.push({ severity: 'warning', sectionId: section.sectionId, message: `Review "${f.rawDictation}": ${r}` });
      }
    }
  }

  // 4) unmapped dictation must be resolved before finalisation
  for (const u of snapshot.unmapped) {
    issues.push({ severity: 'error', message: `Unmapped dictation: "${u.rawText}" — ${u.reason || 'place it manually'}` });
  }
  // 5) review queue items
  for (const r of snapshot.reviewItems) {
    issues.push({ severity: 'warning', message: r.message });
  }
  return issues;
}
