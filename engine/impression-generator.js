// impression-generator.js — evidence-grounded impression generation.
//
// Rules enforced by construction:
//   • Every positive impression line maps to a documented finding (source id kept).
//   • Suggested negatives only when their section is entirely normal/i.e. documented.
//   • No inventing normality for structures that the radiologist never mentioned
//     — template normals are clearly labelled when used.
//   • Correlation with the indication only when an explicitly configured pattern
//     matches; otherwise an advisory line, never a forced diagnosis.

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function siteShort(sitePhraseText) {
  if (!sitePhraseText) return '';
  return String(sitePhraseText).replace(/^the /, '');
}

function filling(template, finding) {
  const severityAdj = finding.severity || '';
  const vars = {
    '{severityAdj}': severityAdj,
    '{sizePhrase}': finding.measure ? `${finding.measure.value} ${finding.measure.unit}` : '',
    '{sizeShort}': finding.measure ? ` (${finding.measure.value} ${finding.measure.unit})` : '',
    '{sitePhrase}': finding.sitePhraseText || '',
    '{siteShort}': siteShort(finding.sitePhraseText),
    '{qualifierShort}': finding.qualifiers ? ` (${finding.qualifiers})` : '',
    '{qualifierPhrase}': finding.qualifiers ? ` with ${finding.qualifiers}` : '',
    '{locationShort}': finding.segmentRoman ? ` (segment ${finding.segmentRoman})`
      : finding.spine ? ` (${finding.spine.display})`
        : finding.location ? ` (${finding.location.phrase})` : '',
  };
  let text = template || '';
  for (const [k, v] of Object.entries(vars)) text = text.split(k).join(v);
  text = text.replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').trim();
  text = capitalize(text);
  if (text && !/[.!?]$/.test(text)) text += '.';
  return text;
}

export class ImpressionGenerator {
  constructor(engine) {
    this.engine = engine;
  }

  build(indication) {
    const engine = this.engine;
    const template = engine.template;
    const findingList = engine.activeFindings()
      .filter((f) => !f.verbatim)
      .sort((a, b) => {
        const ra = engine.sectionById(a.sectionId)?.rules.find((r) => r.id === a.ruleKey);
        const rb = engine.sectionById(b.sectionId)?.rules.find((r) => r.id === b.ruleKey);
        const pa = (ra && (ra.impressionPriority ?? 3)) || 3;
        const pb = (rb && (rb.impressionPriority ?? 3)) || 3;
        return pa - pb || a.sequence - b.sequence;
      });

    const lines = [];
    for (const f of findingList) {
      if (f.status !== 'active') continue;
      const rule = engine.sectionById(f.sectionId)?.rules.find((r) => r.id === f.ruleKey);
      const tpl = (rule && rule.impressionText) || '{subject}';
      const text = filling(tpl, f);
      lines.push({ text, basis: 'finding', sourceFindingIds: [f.id], sectionId: f.sectionId });
    }

    // verbatim findings listed for manual placement, clearly flagged
    for (const f of findingList.filter((x) => x.verbatim)) {
      lines.push({
        text: `Review: ${f.verbatimText}`,
        basis: 'unmapped-finding',
        sourceFindingIds: [f.id],
        sectionId: f.sectionId,
        flag: 'review',
      });
    }

    // suggested clinically-relevant negatives — only from documented normal sections
    const indicationLower = String(indication || engine.indication || '').toLowerCase();
    if (template.relevantNegatives && indicationLower) {
      for (const neg of template.relevantNegatives) {
        let re;
        try { re = new RegExp(neg.match, 'i'); } catch { continue; }
        if (!re.test(indicationLower)) continue;
        const sectionSnap = engine.snapshot().sections.find((s) => s.sectionId === neg.requiresSectionNormal);
        const noFindings = !engine.activeFindings().some((f) => f.sectionId === neg.requiresSectionNormal);
        if (noFindings && sectionSnap) {
          lines.push({
            text: capitalize(neg.clause),
            basis: 'documented-normal',
            sourceFindingIds: [],
            sectionId: neg.requiresSectionNormal,
            isSuggestedNegative: true,
          });
        }
      }
    }

    // indication correlation — pattern-driven, never forced
    const notes = [];
    if (indicationLower) {
      const patterns = template.indicationPatterns || [];
      let matched = false;
      for (const pattern of patterns) {
        let re;
        try { re = new RegExp(pattern.match, 'i'); } catch { continue; }
        if (re.test(indicationLower)) {
          notes.push({ text: pattern.line, basis: 'indication-pattern' });
          matched = true;
        }
      }
      if (!matched) {
        notes.push({ text: 'No definite correlation with the clinical indication established from the reported findings; clinical correlation is advised.', basis: 'advisory' });
      }
    } else {
      notes.push({ text: 'Clinical indication not provided; impression generated from documented findings only. Clinical correlation is advised.', basis: 'advisory' });
    }

    if (!lines.length) {
      lines.unshift({
        text: 'No definite abnormality demonstrated in the regions covered by this template.',
        basis: 'template-guaranteed',
        sourceFindingIds: [],
      });
    }

    return {
      heading: 'IMPRESSION',
      lines,
      notes,
      generatedAt: new Date().toISOString(),
      disclosure: 'Impression generated only from documented findings and template normals. Review every line before finalisation.',
    };
  }
}
