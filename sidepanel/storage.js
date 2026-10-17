// sidepanel/storage.js — thin chrome.storage.local wrapper.
// Stores: app settings + the editable template library (JSON). Patient data is
// never persisted here; the report lives only in the panel's memory until
// copied, and New Report clears it.

const DEFAULT_TEMPLATES_URI = ['templates/cect-abdomen.json', 'templates/ncct-brain.json', 'templates/mri-lumbar-spine.json'];

function localGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function localSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

/** fetch a bundled default template once and cache it into storage */
async function ensureDefaults() {
  const { templates } = await localGet(['templates']);
  if (templates && Object.keys(templates).length) {
    return;
  }
  const built = {};
  for (const uri of DEFAULT_TEMPLATES_URI) {
    try {
      const url = chrome.runtime.getURL(uri);
      const res = await fetch(url);
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
