// template-engine.js — the stateful core of Rad-Copilot.
//
// Owns:
//   • the compiled template (sections, normal statements, rules, slots)
//   • the session finding list (structured, evolving, correctable)
//   • incremental rendering: only affected sections are re-rendered
//   • an audit trail (events) and an explicit review queue (never silent)
//
// Pure data + functions: no browser APIs, no Node APIs → runs in the Chrome
// side panel and in the Node test runner.

import {
  matchPhrases, escapeRegex, resolveOrgan, sitePhrase, QUALIFIER_WHITELIST,
} from './anatomy.js';
import { SEVERITY_ADJ } from './severity.js';
import { measurePhrase, romanSegment } from './units.js';
import { parseFragment, parseUtterance, extractQualifiers, normalizeText } from './dictation.js';
import { parseMeasure } from './units.js';

const SEQ = { n: 0 };
function nextId(prefix) {
  return `${prefix}#${++SEQ.n}`;
}

// ---------------------------------------------------------------------------
// Template compilation
// ---------------------------------------------------------------------------

export function compileTemplate(json) {
  if (!json || typeof json !== 'object') throw new Error('Template is not an object');
  if (!json.id) throw new Error('Template missing "id"');
  if (!Array.isArray(json.sections) || !json.sections.length) throw new Error('Template missing "sections"');

  const sections = json.sections.map((s, idx) => {
    if (!s.id || !s.title) throw new Error(`Section ${idx + 1} missing "id" or "title"`);
    const rules = (s.rules || []).map((r) => {
      if (!r.id || !Array.isArray(r.matchPhrases) || !r.matchPhrases.length) {
        throw new Error(`Section "${s.id}" rule missing "id"/"matchPhrases"`);
      }
      if (!r.render) {
        throw new Error(`Rule "${r.id}" missing "render"`);
      }
      return {
        ...r,
        sectionId: s.id,
        slot: r.slot || null,
        subject: r.subject || r.matchPhrases[0],
        impressionPriority: r.impressionPriority ?? 3,
        impressionTexplate: r.impressionText || null,
      };
    });
    const slots = (s.slots || []).map((sl) => ({
      id: sl.id,
      replaceNormal: sl.replaceNormal || null,
    }));
    const organHints = s.organHints || [];
    const organ = s.organ || ORGAN_BY_SECTION[s.id] || s.id;
    return { ...s, rules, slots, organHints, organ };
  });

  return {
    id: json.id,
    name: json.name || json.id,
    studyType: json.studyType || '',
    defaultPhase: json.defaultPhase || null,
    indicationPatterns: json.indicationPatterns || [],
    relevantNegatives: json.relevantNegatives || [],
    sections,
  };
}

function sectionForOrgan(template, organId) {
  if (!organId) return null;
  const byId = template.sections.find((s) => s.id === organId || s.id === ORGAN_SECTION[organId]);
  return byId || null;
}

const ORGAN_SECTION = {
  kidney: 'kidneys',
  liver: 'liver',
  spleen: 'spleen',
  pancreas: 'pancreas',
  gallbladder: 'gallbladder',
  biliary: 'biliary',
  bowel: 'bowel',
  stomach: 'stomach',
  adrenal: 'adrenals',
  vessel: 'vasculature',
  bladder: 'bladder',
  prostate: 'prostate',
  uterus: 'uterus-adnexa',
  peritoneum: 'peritoneum',
  lung: 'lung-bases',
  bone: 'bones',
};

// ---------------------------------------------------------------------------
// Finding rendering
// ---------------------------------------------------------------------------

function qualifierPhrase(qualifiers) {
  if (!qualifiers) return '';
  const q = String(qualifiers).trim();
  if (!q) return '';
  if (/^(with|without|in|of|involving|containing|along|around|anterior|posterior|medial|lateral)/i.test(q)) {
    return ` ${q}`;
  }
  return ` with ${q}`;
}

function qualifierAdjective(qualifiers) {
  const q = String(qualifiers || '').trim();
  return q ? ` ${q}` : '';
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function buildLocationPhrase(rule, finding) {
  const style = rule.locationStyle || 'inSite';
  if (finding.segmentRoman) return `in segment ${finding.segmentRoman}`;
  if (finding.spine) return `at ${finding.spine.display}`;
  if (!finding.location) return '';
  if (style === 'pole' && /pole$/.test(finding.location.phrase)) return '';
  return `in the ${finding.location.phrase}`;
}

export function renderSentence(rule, finding) {
  const render = typeof rule.render === 'string' ? { default: rule.render } : rule.render;
  let tpl = (finding.laterality && render[finding.laterality]) || render.default || '{subject} is noted';
  const severityAdj = finding.severity ? (SEVERITY_ADJ[finding.severity] || finding.severity) : '';
  const adjectives = rule.qualifierMode === 'adjective' ? qualifierAdjective(finding.qualifiers) : '';
  const polePhrase = finding.location && /pole$/.test(finding.location.phrase) && (rule.locationStyle === 'pole')
    ? ` in the ${finding.location.phrase}` : '';
  const vars = {
    '{subject}': rule.subject || finding.phrase,
    '{severityAdj}': severityAdj,
    '{severityCap}': capitalize(severityAdj),
    '{lateralityAdj}': finding.laterality === 'bilateral' ? 'bilateral' : '',
    '{sizePhrase}': finding.measure ? measurePhrase(finding.measure) : '',
    '{qualifierPhrase}': rule.qualifierMode === 'adjective' ? '' : qualifierPhrase(finding.qualifiers),
    '{qualifiersAdj}': adjectives,
    '{sitePhrase}': finding.sitePhraseText || '',
    '{locationPhrase}': buildLocationPhrase(rule, finding),
    '{polePhrase}': polePhrase,
    '{phasePhrase}': finding.phase ? ` in the ${finding.phaseLabel || finding.phase} phase` : '',
  };
  let text = tpl;
  for (const [k, v] of Object.entries(vars)) text = text.split(k).join(v);
  text = text.replace(/\(\s*\)/g, ' ')      // drop empty parentheses
    .replace(/\s*,\s*\./g, '.')
    .replace(/\s+([.,])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/[.!?]$/.test(text)) text += '.';
  text = capitalize(text);
  return text;
}

// ---------------------------------------------------------------------------
// Reporting engine
// ---------------------------------------------------------------------------

export class ReportingEngine {
  constructor(templateJson) {
    this.template = compileTemplate(templateJson);
    this.reset();
  }

  reset() {
    this.findings = [];        // structured findings: active + retracted
    this.events = [];          // audit trail
    this.reviewItems = [];     // unresolved ambiguities for the radiologist
    this.unmapped = [];        // dictation with no section mapping
    this.indication = null;
    this.sectionDirty = new Set(this.template.sections.map((s) => s.id));
    this.sectionCache = {};
    this.reportDraftFinal = false;
  }

  activeFindings() {
    return this.findings.filter((f) => f.status === 'active');
  }

  setIndication(text) {
    this.indication = (text || '').trim() || null;
  }

  sectionById(id) {
    return this.template.sections.find((s) => s.id === id) || null;
  }

  emitEvent(type, msg, detail) {
    this.events.push({ id: nextId('ev'), type, message: msg, detail: detail || '', t: Date.now() });
  }

  markReview(finding, reason) {
    if (!finding.needsReview.find((r) => r === reason)) finding.needsReview.push(reason);
  }

  // ---------------------------------------------------------------------------
  // Ingestion
  // ---------------------------------------------------------------------------

  ingest(text) {
    const fragments = parseUtterance(text);
    const applied = [];
    for (const frag of fragments) applied.push(this.applyFragment(frag));
    return applied;
  }

  applyFragment(frag) {
    if (frag.kind === 'correction') return this.applyCorrection(frag);
    if (frag.kind === 'retraction') return this.applyRetraction(frag);
    return this.applyFinding(frag);
  }

  /** resolve section + rule for a finding fragment.
   *  If an organ is detected in the fragment, candidate rules are restricted to
   *  that organ's section — this is what maps "cyst" in a kidney phrase to the
   *  kidney section rather than an identically-named liver rule. */
  resolveRuleAndSection(frag, restrictedSectionId) {
    const organ = resolveOrgan(frag.normalized);
    const wanted = restrictedSectionId || (organ ? ORGAN_SECTION[organ] : null);
    const candidates = wanted ? this.template.sections.filter((s) => s.id === wanted) : this.template.sections;

    let best = null; // { rule, phrase, section }
    for (const section of candidates) {
      for (const rule of section.rules) {
        const hits = matchPhrases(frag.normalized, rule.matchPhrases);
        const longest = hits[0];
        if (longest && (!best || longest.length > best.phrase.length)) {
          best = { rule, phrase: longest, section };
        }
      }
    }
    if (best) return best;

    // wanted section had no matching rule → scan all sections before giving up
    if (wanted) {
      for (const section of this.template.sections) {
        for (const rule of section.rules) {
          const hits = matchPhrases(frag.normalized, rule.matchPhrases);
          const longest = hits[0];
          if (longest && (!best || longest.length > best.phrase.length)) {
            best = { rule, phrase: longest, section };
          }
        }
      }
      if (best) {
        return best;
      }
    }

    // no rule matched → organ routing + verbatim
    let section = wanted ? this.sectionById(wanted) : null;
    if (!section && frag.organ) section = sectionForOrgan(this.template, frag.organ);
    if (!section) {
      for (const s of this.template.sections) {
        if (matchPhrases(frag.normalized, s.organHints).length) { section = s; break; }
      }
    }
    if (!section) return null;
    const verbatimRule = section.rules.find((r) => r.id === 'verbatim') || {
      id: 'verbatim',
      sectionId: section.id,
      matchPhrases: [],
      subject: 'documented finding',
      slot: null,
      render: { default: '{verbatimText}' },
      impressionPriority: 4,
      verbatim: true,
    };
    return { rule: verbatimRule, phrase: frag.normalized, section, verbatim: true };
  }

  /** negation directly before the matched phrase => the user is stating a normal */
  isNegatedStatement(frag, matchedPhrase) {
    if (!frag.hasNegation) return false;
    const negs = ['no ', 'without ', 'no evidence of '];
    const idx = frag.normalized.indexOf(matchedPhrase.toLowerCase());
    if (idx < 0) return false;
    const before = frag.normalized.slice(Math.max(0, idx - 12), idx);
    return negs.some((n) => before.includes(n));
  }

  applyFinding(frag) {
    // organ normal statements: "liver normal", "spleen is unremarkable"
    if (frag.organ && this.isAffirmNormalStatement(frag)) {
      return this.affirmNormalForSection(ORGAN_SECTION[frag.organ], frag.rawText);
    }

    const resolved = this.resolveRuleAndSection(frag);
    if (!resolved) {
      const item = { id: nextId('unmapped'), rawText: frag.rawText, normalized: frag.normalized, reason: 'No section could be identified. Please dictate the organ, e.g. “in the liver”.', sectionId: null };
      this.reviewItems.push({ findingId: item.id, message: 'Unmapped dictation: ' + frag.rawText });
      this.unmapped.push(item);
      this.emitEvent('unmapped', 'Dictation unmapped', frag.rawText);
      return { ok: false, unmapped: true, frag, finding: null };
    }

    const { rule, section, phrase, verbatim } = resolved;

    // negated statement of a known rule → retraction path (or no-op confirmation)
    if (!verbatim && this.isNegatedStatement(frag, phrase)) {
      const candidates = this.findingMatchesForPhrase(this.activeFindings(), phrase);
      if (candidates.length === 1) {
        const f = candidates[0];
        f.status = 'retracted';
        this.sectionDirty.add(f.sectionId);
        this.emitEvent('retract', `Retracted by dictation: “${f.rawDictation}”`, f.id);
        return { ok: true, action: 'retracted', finding: f };
      }
      if (candidates.length === 0) {
        this.emitEvent('confirm', 'Stated normal (already reflected in template)', frag.rawText);
        return { ok: true, action: 'no-op', finding: null };
      }
      this.emitEvent('review', '“' + frag.rawText + '” — statement matches a normal: no action', frag.rawText);
      return { ok: true, action: 'no-op', finding: null };
    }

    // affirm-normal for whole organ: "liver normal", "spleen is unremarkable"
    if (!verbatim && frag.organ && this.isAffirmNormalStatement(frag)) {
      return this.affirmNormalForSection(ORGAN_SECTION[frag.organ], frag.rawText);
    }

    const finding = this.buildFinding(frag, rule, section, phrase, verbatim);
    let updatedExisting = false;
    if (verbatim) {
      this.findings.push(finding);
    } else {
      updatedExisting = this.mergeOrAppend(finding);
    }

    this.sectionDirty.add(finding.sectionId);
    if (verbatim) {
      this.reviewItems.push({ findingId: finding.id, message: 'Dictation could not be classed in a template rule. Kept verbatim — review before finalising: ' + frag.rawText });
      this.emitEvent('verbatim', 'Kept verbatim (review): ' + frag.rawText, finding.id);
    } else if (updatedExisting) {
      this.emitEvent('refine', `Updated existing finding: ${finding.phrase}`, finding.id);
    } else {
      this.emitEvent('add', `Documented ${finding.phrase}`, finding.id);
    }
    return { ok: true, finding, updatedExisting };
  }

  isAffirmNormalStatement(frag) {
    const t = frag.normalized;
    return /\b(normal|unremarkable|reveals nothing|is negative)\b/.test(t) && !frag.measure;
  }

  affirmNormalForSection(sectionId, rawText) {
    const section = sectionId && this.sectionById(sectionId);
    if (!section) { this.unmapped.push({ rawText, reason: 'No section for NORMAL statement' }); return { ok: false, unmapped: true }; }
    const actives = this.activeFindings().filter((f) => f.sectionId === sectionId);
    for (const f of actives) {
      f.status = 'retracted';
      this.sectionDirty.add(sectionId);
      this.emitEvent('retract', `Cleared following statement that the structure is normal: “${f.rawDictation}”`, f.id);
    }
    this.emitEvent('confirm', `${section.title} affirmed normal`, '');
    return { ok: true, action: 'affirm-normal', sectionId };
  }

  buildFinding(frag, rule, section, phrase, verbatim) {
    const consumed = [...frag.consumedPhrases, phrase, ...(rule.matchPhrases || [])];
    const qualifiers = verbatim ? '' : extractQualifiers(frag.normalized, consumed);
    const f = {
      id: nextId('f'),
      sectionId: section.id,
      sectionTitle: section.title,
      ruleKey: rule.id,
      slotKey: rule.slot || null,
      phrase,
      subject: rule.subject || phrase,
      organId: frag.organ || null,
      laterality: frag.laterality || null,
      severity: frag.severity || null,
      measure: frag.measure ? { value: frag.measure.value, unit: frag.measure.unit } : null,
      location: frag.location ? { key: frag.location.key, phrase: frag.location.phrase } : null,
      segmentRoman: frag.liverSegment || null,
      spine: frag.spine || null,
      phase: frag.phase || null,
      phaseLabel: frag.phase || null,
      qualifiers: qualifiers || '',
      rawDictation: frag.rawText,
      normalizedText: frag.normalized,
      status: 'active',
      revision: 1,
      needsReview: [],
      verbatim: !!verbatim,
      verbatimText: verbatim ? frag.rawText : '',
      sequence: this.findings.length,
      sitePhraseText: sitePhrase(section.organ || ORGAN_BY_SECTION[section.id] || null, frag.laterality),
    };
    // unusual descriptor words are preserved verbatim but flagged for review
    const oddWords = (qualifiers || '')
      .split(/[^\w-]+/).filter(Boolean)
      .filter((w) => !QUALIFIER_WHITELIST.has(w));
    if (!verbatim && oddWords.length) {
      f.needsReview.push(`unusual descriptor words — verify meaning: “${oddWords.join(' ')}”`);
      this.reviewItems.push({ findingId: f.id, message: `Unusual descriptors in “${frag.rawText}”: ${oddWords.join(' ')} — kept verbatim, review before finalising.` });
    }
    if (frag.laterality == null && rule.localeDefaults) {
      f.laterality = rule.localeDefaults.laterality || null;
    }
    if (frag.laterality && frag.laterality === 'bilateral') {
      f.sitePhraseText = sitePhrase(section.organ || ORGAN_BY_SECTION[section.id] || null, frag.laterality);
    }
    return f;
  }

  /** true if the new finding refined/updated an existing compatible finding */
  mergeOrAppend(finding) {
    if (finding.verbatim) { this.findings.push(finding); return false; }
    for (const existing of this.activeFindings()) {
      if (existing.id === finding.id) continue;   // never merge into itself
      if (existing.ruleKey !== finding.ruleKey) continue;
      if (existing.sectionId !== finding.sectionId) continue;
      // location must not conflict
      const sameLoc = (!existing.segmentRoman && !finding.segmentRoman)
        && (!existing.spine && !finding.spine)
        && (!existing.location && !finding.location);
      const equalLoc = (existing.segmentRoman && finding.segmentRoman && existing.segmentRoman === finding.segmentRoman)
        || (existing.spine && finding.spine && existing.spine.display === finding.spine.display)
        || (existing.location && finding.location && existing.location.key === finding.location.key);
      if (!sameLoc && !equalLoc) continue;

      // laterality compatibility
      const eLat = existing.laterality, nLat = finding.laterality;
      const latCompat =
        (!nLat) || (!eLat) || (eLat === nLat) ||
        (eLat === 'bilateral' && nLat) || ((eLat === 'right' || eLat === 'left') && !nLat);
      if (!latCompat) continue;

      // merge update
      if (finding.laterality && (!eLat || eLat === 'bilateral' || eLat === finding.laterality)) existing.laterality = finding.laterality;
      if (finding.severity) existing.severity = finding.severity;
      if (finding.measure) {
        if (existing.measure && existing.measure.value !== finding.measure.value) {
          const prev = measurePhrase(existing.measure);
          const nu = measurePhrase(finding.measure);
          existing.measure = finding.measure;
          this.markReview(existing, `measurement changed from ${prev} to ${nu} — confirm which is intended`);
        } else {
          existing.measure = finding.measure;
        }
      }
      if (finding.qualifiers) existing.qualifiers = finding.qualifiers;
      if (finding.phase) existing.phase = finding.phase;
      existing.revision++;
      existing.rawDictation = finding.rawDictation;
      existing.sequence = finding.sequence;
      this.markReview(existing, 'existing finding updated — confirm details are for the same lesion');
      this.sectionDirty.add(existing.sectionId);
      return true;
    }
    this.findings.push(finding);
    return false;
  }

  /** robust matcher for corrections/retractions: understand canonical measure
   *  phrases ("five mm" vs 5 mm) and rule alias phrases, not just raw text. */
  findingMatchesForPhrase(pool, targetPhrase) {
    const target = normalizeText(targetPhrase);
    const tm = parseMeasure(target);
    const candidates = [];
    for (const f of pool) {
      const rule = this.sectionById(f.sectionId)?.rules.find((r) => r.id === f.ruleKey);
      const aliasTexts = [
        f.phrase,
        f.subject,
        f.ruleKey,
        f.rawDictation,
        f.normalizedText,
        ...((rule && rule.matchPhrases) || []),
      ].filter(Boolean);
      const hits = matchPhrases(target, aliasTexts);
      const phraseHit = hits[0] && hits[0].length >= 4;
      const measureHit = tm && f.measure
        && tm.value === f.measure.value && tm.unit === f.measure.unit;
      const spineHit = f.spine && target.includes(f.spine.display.toLowerCase());
      const segmentHit = f.segmentRoman
        && target.includes(`segment ${f.segmentRoman.toLowerCase()}`);
      if (phraseHit || measureHit || spineHit || segmentHit) candidates.push(f);
    }
    return candidates;
  }

  // ---------------------------------------------------------------------------
  // Corrections and retractions
  // ---------------------------------------------------------------------------

  applyCorrection(frag) {
    // parse the new phrase as a finding fragment to inherit structure from it
    const newFrag = parseFragment(frag.newPhrase);
    if (!newFrag || newFrag.kind !== 'finding') {
      this.reviewItems.push({ message: `Correction could not be parsed: “${frag.rawText}”. Review manually.` });
      this.emitEvent('review', 'Could not understand correction new value', frag.rawText);
      return { ok: false };
    }
    const resolved = this.resolveRuleAndSection(newFrag);

    // candidates: active findings matching the target phrase
    let candidates = this.findingMatchesForPhrase(this.activeFindings(), frag.targetPhrase);
    // if the new phrase mentions an organ, narrow to that section
    const organ = resolveOrgan(frag.newPhrase) || resolveOrgan(frag.targetPhrase);
    if (organ && ORGAN_SECTION[organ]) {
      const narrowed = candidates.filter((f) => f.sectionId === ORGAN_SECTION[organ]);
      if (narrowed.length) candidates = narrowed;
    }
    if (candidates.length === 0) {
      this.emitEvent('review', `No finding matched the correction “${frag.targetPhrase}” — nothing changed.`, frag.rawText);
      return { ok: false };
    }
    if (candidates.length > 1) {
      this.markAmbiguousCorrection(candidates, frag);
      return { ok: false };
    }

    const target = candidates[0];
    const prevSectionId = target.sectionId;
    // resolve the new rule inside the target's section first — "cyst with thin
    // internal septation" must stay in the kidney section, not hop to liver.
    const resolvedForTarget = this.resolveRuleAndSection(newFrag, target.sectionId) || resolved;
    const rule = resolvedForTarget.rule;
    const section = resolvedForTarget.section;
    const finding = this.buildFinding(newFrag, rule, section, resolvedForTarget.phrase, false);
    // carry forward anything the new utterance did not restate
    if (!finding.laterality) finding.laterality = target.laterality;
    if (!finding.severity) finding.severity = target.severity;
    if (!finding.measure) finding.measure = target.measure;
    if (!finding.location) finding.location = target.location;
    if (!finding.segmentRoman) finding.segmentRoman = target.segmentRoman;
    if (!finding.spine) finding.spine = target.spine;
    if (!finding.phase) finding.phase = target.phase;
    if (!finding.qualifiers) finding.qualifiers = target.qualifiers;
    finding.sectionTitle = section.title;
    finding.sitePhraseText = sitePhrase(section.organ || ORGAN_BY_SECTION[section.id] || null, finding.laterality);

    // replace in place, keep audit
    target.status = 'retracted';
    target.replacedBy = finding.id;
    finding.id = target.id; // keep stable identity
    finding.revision = target.revision + 1;
    const idx = this.findings.findIndex((f) => f.id === target.id || f.id === finding.id);
    if (idx >= 0) this.findings[idx] = finding;
    else this.findings.push(finding);

    // collision with ANOTHER live finding? keep the corrected one, retire and
    // flag the other — never leave a duplicate.
    const others = this.activeFindings().filter((f) =>
      f.id !== finding.id && f.ruleKey === finding.ruleKey && f.sectionId === finding.sectionId
      && this.locationCompatible(f, finding) && this.lateralityCompatible(f, finding));
    for (const other of others) {
      other.status = 'retracted';
      other.replacedBy = finding.id;
      this.markReview(finding, `correction collided with “${other.rawDictation}” which was retracted — verify the final version`);
      this.sectionDirty.add(other.sectionId);
    }

    this.sectionDirty.add(prevSectionId);
    this.sectionDirty.add(finding.sectionId);
    this.emitEvent('revise', `Revised: ${target.phrase} → ${finding.phrase}`, finding.id);
    return { ok: true, finding };
  }

  locationCompatible(a, b) {
    if (a.segmentRoman && b.segmentRoman) return a.segmentRoman === b.segmentRoman;
    if (a.spine && b.spine) return a.spine.display === b.spine.display;
    if (a.location && b.location) return a.location.key === b.location.key;
    return !a.segmentRoman && !b.segmentRoman && !a.spine && !b.spine && !a.location && !b.location;
  }

  lateralityCompatible(a, b) {
    return !b.laterality || !a.laterality || a.laterality === b.laterality
      || a.laterality === 'bilateral' || b.laterality === 'bilateral';
  }

  markAmbiguousCorrection(candidates, frag) {
    const names = candidates.map((c) => `“${c.rawDictation}”`).join(' | ');
    const item = { message: `Correction “${frag.rawText}” matches multiple findings: ${names}. Did not guess.` };
    this.reviewItems.push(item);
    this.sectionDirty.add('!!reviews');
    this.emitEvent('review', `Correction ambiguous between: ${names}`, '');
  }

  applyRetraction(frag) {
    const candidates = this.findingMatchesForPhrase(this.activeFindings(), frag.targetPhrase);
    if (candidates.length === 0) {
      this.emitEvent('review', `Removal request could not identify any finding: “${frag.rawText}”.`, '');
      return { ok: false };
    }
    if (candidates.length > 1) {
      const names = candidates.map((c) => `“${c.rawDictation}”`).join(' | ');
      this.reviewItems.push({ message: `Removal “${frag.rawText}” matches multiple findings: ${names}. Did not guess.` });
      this.emitEvent('review', `Removal ambiguous between: ${names}`, '');
      return { ok: false };
    }
    const f = candidates[0];
    f.status = 'retracted';
    this.sectionDirty.add(f.sectionId);
    this.emitEvent('retract', `Retracted: “${f.rawDictation}”`, f.id);
    return { ok: true, finding: f };
  }

  // ---------------------------------------------------------------------------
  // Rendering (incremental)
  // ---------------------------------------------------------------------------

  renderSection(section) {
    if (!this.sectionDirty.has(section.id) && this.sectionCache[section.id]) {
      return this.sectionCache[section.id];
    }
    const lines = section.normalStatements.map((t) => ({ text: t, origin: 'normal' }));
    const active = this.activeFindings().filter((f) => f.sectionId === section.id);

    // verbatim findings first, they are appended raw with review flag
    const slottedMap = new Map(); // slotId -> findings[]
    const unslotted = [];
    for (const f of active) {
      if (f.verbatim) continue;
      if (f.slotKey) {
        if (!slottedMap.has(f.slotKey)) slottedMap.set(f.slotKey, []);
        slottedMap.get(f.slotKey).push(f);
      } else {
        unslotted.push(f);
      }
    }

    // replace normal sentences occupied by slots
    for (const slot of section.slots) {
      const group = slottedMap.get(slot.id) || [];
      if (!group.length) continue;
      const rendered = group.map((f) => {
        const rule = section.rules.find((r) => r.id === f.ruleKey);
        return { text: renderSentence(rule, f), origin: 'slot', slotId: slot.id };
      });
      let replaced = false;
      if (slot.replaceNormal) {
        const target = slot.replaceNormal.toLowerCase();
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].origin === 'normal' && lines[i].text.toLowerCase().includes(target)) {
            lines.splice(i, 1, ...rendered);
            replaced = true;
            break;
          }
        }
      }
      if (!replaced) {
        lines.push(...rendered);
      }
    }

    for (const f of unslotted) {
      if (f.verbatim) {
        lines.push({ text: f.verbatimText, origin: 'verbatim', findingId: f.id, flag: 'review' });
      } else {
        const rule = section.rules.find((r) => r.id === f.ruleKey);
        if (rule) lines.push({ text: renderSentence(rule, f), origin: 'added', findingId: f.id });
      }
    }

    const out = { sectionId: section.id, title: section.title, lines };
    this.sectionCache[section.id] = out;
    if (this.sectionDirty.has(section.id)) {
      this.sectionDirty.delete(section.id);
    } else {
      // shouldn't happen (means render called twice without change) — keep cache authoritative
    }
    return out;
  }

  snapshot() {
    const sections = this.template.sections.map((s) => this.renderSection(s));
    return {
      templateId: this.template.id,
      indication: this.indication,
      sections,
      unmapped: this.unmapped.map((u) => ({ ...u })),
      reviewItems: this.reviewItems.map((r) => ({ ...r })),
      events: this.events.slice(-60).map((e) => ({ ...e })),
      activeFindings: this.activeFindings().map((f) => ({ ...f })),
    };
  }

  invalidateAll() {
    this.sectionDirty = new Set(this.template.sections.map((s) => s.id));
    this.sectionCache = {};
  }
}

export const ORGAN_BY_SECTION = Object.fromEntries(
  Object.entries(ORGAN_SECTION).map(([organ, section]) => [section, organ]),
);
