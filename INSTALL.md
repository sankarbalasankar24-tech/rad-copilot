# Step-by-Step Installation Guide — Rad-Copilot

Estimated time: **5 minutes**, one time per computer. Requires Google Chrome 116+ (Windows, Mac, Linux or Chromebook).

---

## Step 1 — Copy the extension folder to the reporting computer

Copy the whole `radiology-copilot` folder (USB stick, network share, or cloud sync) to the machine you report on. Any location works — e.g. `C:\Apps\radiology-copilot` — but **keep the folder in place permanently**: Chrome loads unpacked extensions directly from it.

## Step 2 — Open the Chrome extensions page

1. Open **Google Chrome**.
2. In the address bar type: `chrome://extensions` and press Enter.

## Step 3 — Enable Developer mode

Toggle **Developer mode** in the top-right corner of that page. Three new buttons appear (Load unpacked / Pack extension / Update).

## Step 4 — Load the extension

1. Click **Load unpacked**.
2. Select the `radiology-copilot` folder itself (the one containing `manifest.json`), not its parent.
3. The card **"Rad-Copilot — Radiology Reporting Assistant" v1.0.0** appears. If you see a red "Errors" button instead, click it and check that the folder was copied completely (manifest.json present at root).

## Step 5 — Pin it and set the keyboard shortcut

1. Click the **puzzle-piece icon** in Chrome's toolbar → pin **Rad-Copilot**.
2. In the address bar type: `chrome://extensions/shortcuts` and press Enter.
3. Find **Toggle the Rad-Copilot whiteboard**, click the empty field, and press **Alt+Shift+R** (any combination works; avoid ones your other software uses).

## Step 6 — Grant microphone permission (first Start only)

1. Click the Rad-Copilot icon (or press `Alt+Shift+R`). The whiteboard side panel opens on the right.
2. Click **🎙️ Start**. Chrome asks for microphone access → click **Allow**.
   If no prompt appears: click the icon left of the address bar → Microphone → Allow → reload the panel.

## Step 7 — One-minute smoke test

1. In the panel, pick **CECT Abdomen & Pelvis (Portal Venous)** in the study dropdown.
2. Click **Start** and say: *"Mild fatty liver."* — within a second the first line under **Liver** should change to *"Liver is normal in size and shows mild steatosis."*
3. Add: *"Five-millimetre simple cyst in segment five."* — "No focal lesion." should disappear, replaced by *"A 5 mm simple cyst is noted in segment V."*
4. Press **✓ Check**, then **📋 Copy Final Report** — paste (Ctrl+V) anywhere to confirm.
5. Click **✚ New Report** to confirm the workspace clears.

## Step 8 — Personalise (optional, recommended)

1. Click **Templates…** in the panel footer.
2. **Settings** block (left column):
   * **Speech language** — `en-IN`/`en-US`/`en-GB` as you prefer.
   * **Dictation engine** — leave on *Chrome Web Speech* to begin (see §Optional below for the fully-local engine).
   * **Personal medical vocabulary** — comma-separated words you use most (e.g. `IHBRD, perinephric, pelvicalyceal`); the correction layer prioritises your list.
3. To edit a template, select it from **Templates**, tweak the JSON, **Validate**, then **Save template**.

## Optional — fully offline dictation (whisper.cpp, free)

1. Download a whisper.cpp build for your OS (github.com/ggml-org/whisper.cpp — open source) and a model file (`ggml-medium` or `ggml-large-v3-turbo` recommended). 2. Start the server: `build\bin\Release\whisper-server.exe -m models/ggml-small.en.bin -l en --port 8080` 3. In **Templates… → Settings**, set **Dictation engine** to *Local whisper.cpp server*, endpoint `http://localhost:8080/inference`, then **Start** as usual. Audio never leaves the machine.
4. Any OpenAI-compatible `/v1/audio/transcriptions` server also works.

## Updating the extension later

Copy the new folder over the old one → `chrome://extensions` → click the circular **Reload (↻)** icon on the Rad-Copilot card.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Load unpacked" fails / no manifest | You picked the wrong folder — select the one with `manifest.json` |
| Panel doesn't open on shortcut | Re-check the binding at `chrome://extensions/shortcuts`; shortcuts must be pressed *inside Chrome* |
| No mic / instant stop | macOS: System Settings → Privacy → Microphone → enable Chrome. Windows: Settings → Privacy → Microphone → toggle for desktop apps |
| Speech stops after a pause | Normal — Chrome restarts recognition automatically; if it does not, click Start again |
| Persistent red "Errors" on the card | Click Errors → Reload after fixing; report the message if it persists |
| Panel hidden behind PACS | Stretch Chrome full-screen and keep the PACS in an overlapping window; the side panel stays on top-right |
| Hospital computer blocks extensions | Ask IT for a policy exception for an *unpacked local* extension — nothing transmits patient data except Chrome's Web Speech audio (or use the local whisper.cpp engine, which transmits nothing) |
