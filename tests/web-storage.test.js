// tests/web-storage.test.js — contract test for the portable (localStorage)
// storage module used by the no-extension web build. Shims localStorage/window
// and stubs fetch to read the real bundled templates from disk, so the default
// seeding logic is exercised end-to-end without a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

// ---- minimal browser shims BEFORE importing the module ----------------------
const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
  clear: () => backing.clear(),
};
globalThis.window = {
  location: { href: 'http://localhost:8000/webapp/index.html' },
};
// map "fetch(new URL('../templates/x.json', href))" to the real files on disk
globalThis.fetch = async (url) => {
  const p = decodeURIComponent(new URL(String(url), globalThis.window.location.href).pathname)
    .replace(/^\/webapp\//, '/radiology-copilot/webapp/');
  const abs = path.join(projectRoot, p);
  const json = JSON.parse(await readFile(abs, 'utf8'));
  return { json: async () => json };
};

const { listTemplates, loadTemplate, saveTemplate, deleteTemplate, getSetting, setSetting, resetAll } =
  await import('../webapp/web-storage.js');

test('defaults seed into localStorage exactly like the extension storage', async () => {
  const defs = await listTemplates();
  const names = defs.map((d) => d.name).sort();
  assert.ok(names.length >= 3, `expected bundled defaults, got ${names}`);
  const t = await loadTemplate(defs[0].id);
  assert.ok(t.sections && Array.isArray(t.sections), 'template loads with sections');
});

test('settings round-trip and template CRUD on localStorage', async () => {
  await setSetting('customVocab', ['IHBRD', 'perinephric']);
  assert.deepEqual(await getSetting('customVocab', []), ['IHBRD', 'perinephric']);
  assert.equal(await getSetting('missing', 'fallback'), 'fallback');

  await saveTemplate('my-study', { id: 'my-study', name: 'My Study', sections: [] });
  const defs = await listTemplates();
  assert.ok(defs.some((d) => d.id === 'my-study'), 'saved template appears in list');
  await deleteTemplate('my-study');
  const after = await listTemplates();
  assert.ok(!after.some((d) => d.id === 'my-study'), 'deleted template gone');
});

test('resetAll wipes state including seeded templates', async () => {
  await resetAll();
  // after reset, ensureDefaults must re-seed (fetch → real files) without error
  const defs = await listTemplates();
  assert.ok(defs.length >= 3, 're-seeded after reset');
  assert.deepEqual(await getSetting('customVocab', []), [], 'settings cleared by reset');
});
