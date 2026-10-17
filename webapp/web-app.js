// webapp/web-app.js — the Rad-Copilot whiteboard running as a plain web page.
// Functionally identical to sidepanel/app.js but with zero chrome.* API use:
//   chrome.storage.local  → localStorage (web-storage.js)
//   chrome.runtime.getURL → relative URLs
//   chrome.tabs.create    → window.open
// Same engine modules are imported from ../engine/*, so the web build and the
// (optional) extension build share one rule engine source of truth.

import { ReportingEngine } from '../engine/template-engine.js';
import { ImpressionGenerator } from '../engine/impression-generator.js';
import { checkConsistency } from '../engine/consistency-checker.js';
import { buildReportText } from '../engine/report-builder.js';
import { createAsrController } from '../sidepanel/asr-controller.js';
import { correctMedicalTerms } from '../engine/medical-vocab.js';
import { inlineStyleFor, buildReportHtml, sanitizeFormat } from '../engine/report-formatter.js';
import { listTemplates, loadTemplate, getSetting, setSetting } from './web-storage.js';

const $ = (id) => document.getElementById(id);
const els = {
  micBtn: $('micBtn'), studySelect: $('studySelect'), indication: $('indication'),
  statusText: $('statusText'), interim: $('interimCaption'),
  reviewBanner: $('reviewBanner'), reviewList: $('reviewList'),
  report: $('report'), impressionPanel: $('impressionPanel'), impressionText: $('impressionText'),
  issuesPanel: $('issuesPanel'), issuesList: $('issuesList'),
  checkBtn: $('checkBtn'), copyBtn: $('copyBtn'), newBtn: $('newBtn'), exportBtn: $('exportBtn'),
  regenImprBtn: $('regenImprBtn'), acceptImprBtn: $('acceptImprBtn'),
  eventLog: $('eventLog'),
};

let engine = null;
let currentTemplateId = null;
let rec = null;
let lastFinals = [];
let currentReportFormat = {};   // Word-style format settings, reloaded before copy

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

async function loadReportFormat() {
  currentReportFormat = sanitizeFormat(await getSetting('reportFormat', {}));
}

async function initTemplates() {
  const defs = await listTemplates();
  els.studySelect.innerHTML = '';
  for (const t of defs) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name || t.id;
    els.studySelect.appendChild(opt);
  }
  const saved = await getSetting('lastTemplateId');
  const preferred = saved && defs.some((d) => d.id === saved) ? saved : defs[0]?.id;
  if (preferred) await selectTemplate(preferred);
}

async function selectTemplate(templateId, { reset = true } = {}) {
  currentTemplateId = templateId;
  els.studySelect.value = templateId;
  await setSetting('lastTemplateId', templateId);
  try {
    const json = await loadTemplate(templateId);
    engine = new ReportingEngine(json);
  } catch (err) {
    setStatus('error', `Template error: ${err.message}`);
    return;
  }
  if (reset) {
    engine.reset();
    lastFinals = [];
  }
  render();
}

// ---------------------------------------------------------------------------
// Statusbar, review banner, event log
// ---------------------------------------------------------------------------

/** Write BOTH text/html and text/plain to the clipboard so the destination
 *  editor keeps the formatting. Falls back to the select+execCommand copy of
 *  a hidden rich element on non-secure contexts (http://LAN-IP). */
async function copyRich(html, plainText) {
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch { /* fall through to the non-async fallback */ }

  // Fallback (LAN/IP origins, older browsers): render the formatted HTML in a
  // hidden editable layer, select it and execCommand('copy'). Word/PACS pick
  // up the rich formatting from the selection; plain-fat text editors get the
  // unstyled words.
  const div = document.createElement('div');
  div.contentEditable = 'true';
  div.setAttribute('style', 'position:fixed;left:-9999px;top:0;opacity:0;white-space:pre-wrap');
  // html is produced exclusively by our own escaping builders — safe to insert
  div.innerHTML = html;
  document.body.appendChild(div);
  const range = document.createRange();
  range.selectNodeContents(div);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  sel.removeAllRanges();
  div.remove();
  return ok;
}

function setStatus(kind, msg) {
  els.statusText.textContent = msg || kind;
  els.statusText.className = kind === 'listening' ? 'listening' : kind;
}

function pushEventLog(msg) {
  const div = document.createElement('div');
  div.textContent = `· ${new Date().toLocaleTimeString()} ${msg}`;
  els.eventLog.prepend(div);
  while (els.eventLog.children.length > 40) els.eventLog.lastChild.remove();
}

// ---------------------------------------------------------------------------
// Whiteboard render
// ---------------------------------------------------------------------------

function render() {
  const flashFirst = true;
  const snap = engine.snapshot();
  els.report.innerHTML = '';

  // paper-look wrapper + empty state
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  els.report.appendChild(sheet);

  for (const section of snap.sections) {
    const wrap = document.createElement('div');
    wrap.className = 'section';
    const h = document.createElement('h3');
    h.textContent = section.title;
    wrap.appendChild(h);
    for (const line of section.lines) {
      const p = document.createElement('p');
      p.className = `sentence ${line.origin || ''}`;
      p.textContent = line.text;
      // section-defined Word-style format, inherited by sentences added later
      p.setAttribute('style', inlineStyleFor(currentReportFormat, section.title));
      if (line.flag) p.title = 'Flagged for review';
      wrap.appendChild(p);
    }
    sheet.appendChild(wrap);
  }

  for (const u of snap.unmapped) {
    const box = document.createElement('div');
    box.className = 'unmappedBlock';
    box.textContent = `⚠ Unmapped dictation (kept for review): "${u.rawText}" — ${u.reason || ''}`;
    sheet.appendChild(box);
  }

  const hasContent = snap.sections.some((s) => s.lines.length || s.flagged) || snap.unmapped.length;
  if (!hasContent) {
    const empty = document.createElement('div');
    empty.className = 'emptyState';
    empty.innerHTML = '<span class="big">🩻</span>Press <b>🎙 Start</b> and dictate, or type <code>__demoDictate("mild fatty liver")</code> in the console to try it without a microphone.';
    sheet.appendChild(empty);
  }
  if (flashFirst) els.report.scrollTop = els.report.scrollHeight;

  // review banner
  els.reviewList.innerHTML = '';
  const items = [...snap.reviewItems];
  for (const f of snap.activeFindings) {
    for (const r of f.needsReview || []) items.push({ message: `${f.rawDictation} — ${r}` });
  }
  if (items.length) {
    els.reviewBanner.classList.remove('hidden');
    for (const it of items) {
      const li = document.createElement('li');
      li.textContent = it.message;
      els.reviewList.appendChild(li);
    }
  } else {
    els.reviewBanner.classList.add('hidden');
  }

  pushEventLog(snap.events.at(-1)?.message || 'Updated');
  updateImpressionPanel();
}

function updateImpressionPanel() {
  const imp = new ImpressionGenerator(engine).build(els.indication.value);
  if (els.impressionPanel.classList.contains('hidden') || true) {
    els.impressionPanel.classList.remove('hidden');
    renderImpression(imp);
  }
}

function renderImpression(imp) {
  els.impressionText.textContent = imp.lines.map((l, i) => `${i + 1}. ${l.text}`).join('\n')
    + '\n' + imp.notes.map((n) => `- ${n.text}`).join('\n');
}

// ---------------------------------------------------------------------------
// Dictation
// ---------------------------------------------------------------------------

async function onFinalText(text, confidence) {
  lastFinals.push({ text, confidence });
  lowConfidenceBadge(text, confidence);
  if (!engine) return;
  // medical vocabulary adaptation before structured parsing, same as extension
  const customVocab = await getSetting('customVocab', []);
  const fixed = correctMedicalTerms(text, {
    customVocab,
    onCorrection: (c) => pushEventLog(`speech corrected: “${c.from}” → “${c.to}”${c.fuzzy ? ' (fuzzy)' : ''}`),
  });
  if (fixed.corrections.length) lowConfidenceBadge(fixed.text, -1);
  engine.ingest(fixed.text);
  render();
}

function lowConfidenceBadge(text, confidence) {
  if (confidence != null && confidence <= 0) {
    const b = document.createElement('div');
    b.className = 'unmappedBlock';
    b.textContent = `⚠ Low speech confidence (${Math.round(confidence * 100)}%): "${text}" — verify this fragment in the report.`;
    els.report.appendChild(b);
  }
}

async function toggleDictation() {
  if (!rec) return;
  if (rec.wantListening || rec.listening) {
    rec.stop();
    els.micBtn.textContent = '🎙️ Start';
    els.micBtn.classList.remove('listening');
  } else {
    const lang = await getSetting('speechLang', 'en-IN');
    rec.setLanguage(lang);
    rec.start();
    els.micBtn.textContent = '⏹ Stop';
    els.micBtn.classList.add('listening');
  }
}

async function initSpeech() {
  const engineName = await getSetting('asrEngine', 'webspeech');
  const endpoint = await getSetting('asrEndpoint', '');
  rec = await createAsrController({
    engine: engineName,
    endpoint,
    language: await getSetting('speechLang', 'en-IN'),
    onFinal: onFinalText,
    onInterim: (t) => { els.interim.textContent = t; },
    onStatus: (kind, msg) => setStatus(kind, msg),
    onLowConfidence: () => {},
  });
  setStatus('idle', engineName === 'whisper-server'
    ? `Backend: local whisper server (${endpoint || 'set endpoint in Templates → Settings'})`
    : 'Backend: Chrome Web Speech (free) — audio processed on Google\'s service.');
}

// ---------------------------------------------------------------------------
// Final review, copy, new
// ---------------------------------------------------------------------------

function runChecks(imp) {
  const issues = checkConsistency(engine);
  els.issuesList.innerHTML = '';
  els.issuesPanel.classList.remove('hidden');
  for (const issue of issues) {
    const li = document.createElement('li');
    li.textContent = issue.message;
    if (issue.severity === 'warning') li.className = 'warn';
    els.issuesList.appendChild(li);
  }
  if (!issues.length) {
    const li = document.createElement('li');
    li.textContent = 'No consistency issues detected. Radiologist review still required before signing.';
    li.className = 'warn';
    els.issuesList.appendChild(li);
  }
  return issues;
}

async function copyFinal() {
  const imp = new ImpressionGenerator(engine).build(els.indication.value);
  const issues = runChecks(imp);
  const hasErrors = issues.some((i) => i.severity === 'error');
  const text = buildReportText(engine, imp);
  await loadReportFormat();  // settings may have just changed in the other tab
  const html = buildReportHtml(engine, imp, currentReportFormat);

  const copied = await copyRich(html, text);
  if (!copied) {
    setStatus('error', 'Copy failed — press Ctrl+A / Ctrl+C in the report, or check clipboard permissions.');
    return;
  }
  setStatus('ok', hasErrors
    ? 'Copied. ⚠ But error-level issues exist — review the consistency panel before signing!'
    : 'Copied to clipboard. Review, then confirm below.');
  const proceed = confirm(hasErrors
    ? 'Error-level consistency issues remain. Paste anyway?'
    : 'Did the final report paste correctly into the hospital software?\nOK = finish and clear the workspace.');
  if (proceed === true) newReport();
}

function newReport() {
  engine.reset();
  els.indication.value = '';
  lastFinals = [];
  els.impressionText.textContent = '';
  els.issuesPanel.classList.add('hidden');
  render();
  setStatus('idle', 'Workspace cleared. Ready for the next patient.');
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

els.micBtn.addEventListener('click', toggleDictation);
els.studySelect.addEventListener('change', (e) => selectTemplate(e.target.value));
els.indication.addEventListener('change', () => engine && render());
els.checkBtn.addEventListener('click', () => {
  const imp = new ImpressionGenerator(engine).build(els.indication.value);
  runChecks(imp);
});
els.copyBtn.addEventListener('click', copyFinal);
els.newBtn.addEventListener('click', () => {
  if (confirm('Clear the workspace and start a new report? All findings will be erased.')) newReport();
});
els.exportBtn.addEventListener('click', () => window.open('./settings.html', '_blank'));
els.regenImprBtn.addEventListener('click', () => {
  const imp = new ImpressionGenerator(engine).build(els.indication.value);
  renderImpression(imp);
});
els.acceptImprBtn.addEventListener('click', () => {
  setStatus('ok', 'Impression marked as reviewed. Editable any time.');
});

document.addEventListener('keydown', (e) => {
  if (e.altKey && e.shiftKey && (e.code === 'KeyS')) { e.preventDefault(); toggleDictation(); }
  if (e.altKey && e.shiftKey && (e.code === 'KeyC')) { e.preventDefault(); copyFinal(); }
});

// Demo/testing hook: type a synthetic dictation without a microphone,
// e.g. __demoDictate('Five-millimetre simple cyst in segment five') in DevTools.
window.__demoDictate = (text) => onFinalText(String(text), 1);

// pick up formatting changes made in the Templates & Settings tab instantly
window.addEventListener('storage', (e) => { if (e.key === 'radcopilot.state.v1') loadReportFormat().then(() => engine && render()).catch(() => {}); });
window.addEventListener('focus', () => loadReportFormat().then(() => engine && render()).catch(() => {}));

loadReportFormat().catch(console.error);
initSpeech().then(() => initTemplates()).catch(console.error);
