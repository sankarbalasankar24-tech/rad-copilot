// webapp/web-storage.js — drop-in replacement for sidepanel/storage.js when the
// app runs as a plain web page (no Chrome extension context).
// Uses localStorage for settings + the editable template library, and fetch()
// (relative to this HTML page's URL) to seed the bundled default templates on
// first run. Patient/report data never persists — same guarantee as the
// extension version.

const DEFAULT_TEMPLATES_URI = ['../templates/cect-abdomen.json', '../templates/ncct-brain.json', '../templates/mri-lumbar-spine.json'];

const KEY = 'radcopilot.state.v1';

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch { return {}; }
}

function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('localStorage write failed (private mode?)', err);
  }
}

function localGet(keys) {
  const state = loadState();
  const out = {};
  for (const k of keys) if (k in state) out[k] = state[k];
  return Promise.resolve(out);
}

function localSet(obj) {
  const state = loadState();
  Object.assign(state, obj);
  saveState(state);
  return Promise.resolve();
}

/** fetch a bundled default template once and cache it into storage */
async function ensureDefaults() {
  const { templates } = await localGet(['templates']);
  if (templates && Object.keys(templates).length) return;
  const built = {};
  for (const uri of DEFAULT_TEMPLATES_URI) {
    try {
      const res = await fetch(new URL(uri, window.location.href));
      const json = await res.json();
      built[json.id] = json;
    } catch (err) {
      console.warn('default template load failed', uri, err);
    }
  }
  await localSet({ templates: built });
}

export async function listTemplates() {
  await ensureDefaults();
  const { templates } = await localGet(['templates']) || {};
  return Object.entries(templates || {})
    .map(([id, t]) => ({ id, name: t.name, studyType: t.studyType }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadTemplate(id) {
  const { templates } = await localGet(['templates']);
  if (!templates || !templates[id]) throw new Error(`Template "${id}" not found`);
  return templates[id];
}

export async function saveTemplate(id, json) {
  const { templates } = await localGet(['templates']);
  const all = templates || {};
  all[id] = json;
  return localSet({ templates: all });
}

export async function deleteTemplate(id) {
  const { templates } = await localGet(['templates']);
  const all = templates || {};
  delete all[id];
  return localSet({ templates: all });
}

export async function getSetting(key, fallback) {
  const res = await localGet([key]);
  return key in res ? res[key] : fallback;
}

export function setSetting(key, value) {
  return localSet({ [key]: value });
}

/** ONLY used by the webapp: factory reset (e.g. to hand the laptop over) */
export function resetAll() {
  localStorage.removeItem(KEY);
  return Promise.resolve();
}
