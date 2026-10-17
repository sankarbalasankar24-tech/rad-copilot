// webapp/settings-web.js — template library editor + settings, identical to
// options/options.js except it uses the web (localStorage) storage instead of
// chrome.storage, so it works as a plain page with no extension.

import { listTemplates, loadTemplate, saveTemplate, deleteTemplate, getSetting, setSetting } from './web-storage.js';
import { compileTemplate } from '../engine/template-engine.js';

const $ = (id) => document.getElementById(id);
let currentId = null;
let formattingReady = null;   // resolves when format controls are initialised
let sectionTitles = [];

function status(msg, warn) {
  const el = $('status');
  el.textContent = msg;
  el.className = warn ? 'warn' : '';
}

async function refreshList() {
  const ul = $('tplList');
  ul.innerHTML = '';
  const tpls = await listTemplates();
  for (const t of tpls) {
    const li = document.createElement('li');
    li.textContent = t.name;
    li.dataset.id = t.id;
    if (t.id === currentId) li.classList.add('selected');
    li.onclick = () => openTemplate(t.id);
    ul.appendChild(li);
  }
}

async function openTemplate(id) {
  currentId = id;
  const json = await loadTemplate(id);
  $('tplEditor').value = JSON.stringify(json, null, 2);
  status(`Loaded "${json.name}"`);
  // refresh the per-section formatting rows for THIS template
  sectionTitles = Array.isArray(json.sections)
    ? json.sections.map((s) => s.title).filter(Boolean)
    : [];
  const fmt = sanitizeFormat(await getSetting('reportFormat', {}));
  renderSectionRows(fmt);
  refreshList();
}

async function init() {
  const tpls = await listTemplates();
  if (tpls.length) await openTemplate(tpls[0].id);
  const lang = await getSetting('speechLang', 'en-IN');
  $('langSel').value = lang;
  $('asrSel').value = await getSetting('asrEngine', 'webspeech');
  $('asrEndpoint').value = await getSetting('asrEndpoint', '');
  const vocab = await getSetting('customVocab', []);
  $('customVocab').value = vocab.join(', ');
}
$('tplList').addEventListener('click', (e) => {
  if (e.target.dataset.id) currentId = e.target.dataset.id;
});

$('newTpl').addEventListener('click', () => {
  currentId = null;
  $('tplEditor').value = JSON.stringify({
    id: 'my-custom-study',
    name: 'My Custom Study',
    studyType: 'Describe protocol',
    sections: [
      {
        id: 'organ-section',
        title: 'Organ',
        organ: 'organ',
        normalStatements: ['Organ is normal.'],
        slots: [{ id: 'lesions', replaceNormal: 'Organ is normal' }],
        rules: [
          {
            id: 'lesion',
            matchPhrases: ['lesion', 'mass'],
            subject: 'lesion',
            slot: 'lesions',
            render: { default: 'A {sizePhrase}{qualifierPhrase} lesion is noted in {sitePhrase}.' },
            impressionText: 'Lesion{locationShort}{sizeShort}.',
          },
        ],
        organHints: [],
      },
    ],
    indicationPatterns: [],
    relevantNegatives: [],
  }, null, 2);
  status('Editing new template — set a unique "id" and Save.');
});

$('importTpl').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    $('tplEditor').value = String(reader.result);
    const imported = JSON.parse(String(reader.result));
    currentId = imported.id || null;
    status('Imported from file — review and Save.');
    await refreshList();
  };
  reader.readAsText(file);
});

$('validateTpl').addEventListener('click', () => {
  try {
    const json = JSON.parse($('tplEditor').value);
    compileTemplate(json);
    status('✔ Template is valid.');
  } catch (err) {
    status(`✖ ${err.message}`, true);
  }
});

$('saveTpl').addEventListener('click', async () => {
  try {
    const json = JSON.parse($('tplEditor').value);
    compileTemplate(json);
    if (!json.id || !/^[a-z0-9-]+$/i.test(json.id)) throw new Error('Template "id" must be a simple slug');
    await saveTemplate(json.id, json);
    currentId = json.id;
    await refreshList();
    status(`✔ Saved "${json.name}"`);
  } catch (err) {
    status(`✖ ${err.message}`, true);
  }
});

$('deleteTpl').addEventListener('click', async () => {
  if (!currentId || !confirm(`Delete template "${currentId}"?`)) return;
  await deleteTemplate(currentId);
  currentId = null;
  $('tplEditor').value = '';
  status('Deleted.');
  await refreshList();
});

$('exportTpl').addEventListener('click', () => {
  const blob = new Blob([$('tplEditor').value], { type: 'application/json' });
  const a = $('downloadLink');
  a.href = URL.createObjectURL(blob);
  a.download = `${currentId || 'rad-template'}.json`;
  a.style.display = 'block';
  a.click();
  status('Exported.');
});

$('langSel').addEventListener('change', (e) => setSetting('speechLang', e.target.value));

$('asrSel').addEventListener('change', (e) => setSetting('asrEngine', e.target.value));
$('asrEndpoint').addEventListener('change', (e) => setSetting('asrEndpoint', e.target.value.trim()));

function parseVocab(v) {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
}
$('customVocab').addEventListener('change', (e) => setSetting('customVocab', parseVocab(e.target.value)));

// ---------------------------------------------------------------------------
// Report formatting (Word style) — global defaults + per-section overrides:
// bold / italic / underline / indent, inherited by any sentence dictated later
// because styles are applied at render & copy time keyed by the section.
// ---------------------------------------------------------------------------

import { sanitizeFormat } from '../engine/report-formatter.js';

const FONTS = ['Segoe UI', 'Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Verdana',
  'Tahoma', 'Trebuchet MS', 'Cambria', 'Consolas', 'Helvetica', 'SimSun'];
const SIZES = [9, 10, 11, 12, 13, 14, 16];

let unused;

function fmtStatus(msg, warn) {
  const el = $('fmtStatus');
  el.textContent = msg;
  el.style.color = warn ? '#b3261e' : '#0b6e4f';
}

function buildStaticControls() {
  const fs = $('fontSel');
  fs.innerHTML = FONTS.map((f) => `<option>${f}</option>`).join('');
  const ss = $('sizeSel');
  ss.innerHTML = SIZES.map((s) => `<option value="${s}">${s} pt</option>`).join('');
}

function renderSectionRows(fmt) {
  const tbody = $('fmtRows');
  tbody.innerHTML = '';
  for (const title of sectionTitles) {
    const o = (fmt.perSection && fmt.perSection[title]) || {};
    const tr = document.createElement('tr');
    const cell = (label) => {
      const td = document.createElement('td');
      td.textContent = label;
      td.style.padding = '2px 6px 2px 0';
      return td;
    };
    tr.appendChild(cell(title));
    for (const key of ['bold', 'italic', 'underline', 'indent']) {
      const td = document.createElement('td');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.section = title;
      cb.dataset.key = key;
      cb.checked = !!o[key];
      td.appendChild(cb);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

async function loadFormatSettings() {
  const fmt = sanitizeFormat(await getSetting('reportFormat', {}));
  $('fontSel').value = fmt.fontFamily;
  $('sizeSel').value = String(fmt.fontSize);
  $('indentAll').checked = !!fmt.indent;
  renderSectionRows(fmt);
}

async function collectAndSaveFormat() {
  const fmt = sanitizeFormat(await getSetting('reportFormat', {}));
  fmt.fontFamily = $('fontSel').value;
  fmt.fontSize = Number($('sizeSel').value);
  fmt.indent = $('indentAll').checked;
  fmt.perSection = {};
  for (const cb of document.querySelectorAll('#fmtRows input[type=checkbox]')) {
    if (cb.checked) {
      const s = (fmt.perSection[cb.dataset.section] ||= {});
      s[cb.dataset.key] = true;
    }
  }
  await setSetting('reportFormat', sanitizeFormat(fmt));
  fmtStatus('✔ Formatting saved — new reports and copies use it immediately.');
}

$('saveFmt').addEventListener('click', () => collectAndSaveFormat().catch((e) => fmtStatus(`✖ ${e.message}`, true)));
$('resetFmt').addEventListener('click', async () => {
  await setSetting('reportFormat', {});
  await loadFormatSettings();
  fmtStatus('Formatting reset to defaults.');
});

buildStaticControls();
formattingReady = loadFormatSettings().catch((e) => fmtStatus(`✖ ${e.message}`, true));

init();
