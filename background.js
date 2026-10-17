// background.js — minimal service worker: opens/toggles the side panel from
// the toolbar action or the global keyboard shortcut. No data processing here;
// all clinical data stays in the side panel context.

const PANEL_PATH = 'sidepanel/index.html';

async function togglePanel(windowId) {
  const url = chrome.runtime.getURL(PANEL_PATH);
  const context = await chrome.sidePanel.setOptions({
    path: PANEL_PATH,
    enabled: true,
  });
  try {
    await chrome.sidePanel.open({ windowId });
  } catch (err) {
    // sidePanel.open must be user-gesture bound; action click and commands are.
    console.warn('sidePanel.open failed', err);
  }
}

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error(e));

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.windowId) togglePanel(tab.windowId);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-panel') {
    chrome.windows.getCurrent((w) => togglePanel(w && w.id));
  }
});
