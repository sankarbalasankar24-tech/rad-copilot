# Rad-Copilot — AI-Powered Radiology Reporting Copilot for Chrome

A **free, subscription-free** dictation-driven reporting whiteboard for consultant
radiologists. Load your **personalised template**, dictate freely while reading
images in your existing PACS viewer, and Rad-Copilot continuously produces an
evolving, anatomically organised report — with a copy-ready plain-text export
for your hospital reporting software.

Run `npm test` to verify the whole clinical engine (15 tests, including every
mandatory acceptance example).

---

## 1. Why this architecture

| Layer | Implementation | Cost |
| --- | --- | --- |
| Chrome interface | Manifest V3 side-panel whiteboard + toolbar button + global shortcut (default `Alt+Shift+R`) | free |
| Speech-to-text | **Pluggable, both free:** ① Chrome Web Speech API (fast, continuous, interim captions, auto-restart — audio is processed on Google's service) ② **local whisper.cpp server** — 100% on-device, zero transmission (`Templates… → Settings`) | free |
| Medical vocabulary adaptation | Deterministic post-processor (`engine/medical-vocab.js`): repairs common ASR mis-hearings (*"perinefric"→perinephric, "desk bulge"→disc bulge, "prostrate"→prostate, "spline"→spleen*), plus your **personal vocabulary** for speaker adaptation — the same technique commercial dictators charge for | free, offline |
| Clinical language model | Deterministic rule engine (`engine/`) — organ routing, laterality / severity / measurement / segment extraction, template slots, correction & retraction grammar | free, offline |
| Structured finding manager | Session finding objects with revision, retraction, dedupe and audit trail (`engine/template-engine.js`) | offline |
| Template engine | Editable JSON templates with `normalStatements` → `slots` → `rules` (see §6) | offline |
| Report validation layer | Contradiction / duplicate / laterality / measurement checks with explicit flags (`engine/consistency-checker.js`) | offline |
| Impression generator | Evidence-grounded: every positive line cites a documented finding; suggested negatives only when their section is documented normal (`engine/impression-generator.js`) | offline |

No network calls. No paid APIs. No cloud. Patient data never leaves the panel
memory; the workspace clears on **Copy confirm** or **New Report**.

## 2. Install (Chrome on any authorised computer)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this `radiology-copilot` folder.
3. In `chrome://extensions/shortcuts`, set **Toggle the Rad-Copilot whiteboard**
   (default `Alt+Shift+R`) — it toggles the panel from any tab you are reading.
4. Grant the **microphone** permission on first Start.
5. Tip: put the PACS tab on the left and Chrome's side panel on the right —
   the whiteboard stays visible while you scroll images.

### Dictation engine choices (both free)

| Engine | Where audio goes | Best for |
| --- | --- | --- |
| Chrome Web Speech | Google's speech service (per MDN; no API key) | Speed, punctuation quality, breathing room while you scan images |
| Local whisper.cpp server | **Stays on your machine** | Strict no-transmission hospital policies |

To switch to the local engine (Whispr-Flow-like workflow, free):

1. Download a whisper.cpp build (open source) and a model
   (`ggml-medium`/`ggml-large-v3-turbo` are good quality/cost trade-offs). 2. Run: `build\bin\Release\whisper-server.exe -m models/ggml-small.en.bin -l en --port 8080`
3. In **Templates… → Settings**, choose *Local whisper.cpp server* and set
   endpoint `http://localhost:8080/inference`. The panel records ~9 s segments,
   sends them nowhere but localhost, and pastes segments as finals. Any
   OpenAI-compatible `/v1/audio/transcriptions` endpoint also works.
4. Add your personal words (party abbreviations, drug names) in the
   *Personal medical vocabulary* box — the adaptation layer applies them
   speaker-specifically, like Augnito-style personalised lexicons.

**Accuracy note (no marketing):** no independent WER study exists for Chrome's
Web Speech API on radiology jargon; Google's own medical ASR benchmarks show
generic Whisper lagging tuned medical ASR by >2× on radiology dictation
(12.5% vs ~5% WER on chest X-ray dictation). Therefore this tool, regardless of
engine, (a) runs the vocabulary-adaptation layer on every transcript, (b) flags
uncertain segments for review, and (c) never lets raw ASR text silently become
report text — everything flows through the structured, reviewable engine.

## 3. Reporting workflow

1. **Pick the study** (e.g. CECT Abdomen & Pelvis PV). Your template loads with
   all organ normal statements.
2. Optionally type the **clinical indication** (used only for impression
   correlation — never stored).
3. Press **Start** (or `Alt+Shift+S`) and dictate naturally, in any order, at
   your own pace: *"mild fatty liver… five-millimetre simple cyst in segment
   five… mild bilateral perinephric fat stranding…"* — no clicking of organs,
   sections, or fields.
4. The whiteboard continuously shows the evolving report with progressively
   updated sentences. Speech below 75% confidence, unusual descriptor words,
   ambiguous corrections, and unmapped fragments are surfaced in a **review
   banner** — never silently resolved.
5. Corrections work mid-flow:
   * *"Change simple cyst to cyst with thin internal septation."* → updates the
     existing finding rather than duplicating it.
   * *"Remove the five mm cyst."* → retracts that finding and restores its
     normal line.
   * *"Liver is normal."* → clears that section's findings.
6. Press **✓ Check** for the consistency review, edit the **draft impression**
   if needed, then **📋 Copy Final Report** (or `Alt+Shift+C`). After you
   confirm the paste, the workspace clears — no patient data carried over.

## 4. Guaranteeing clinical safety

* **Nothing is finalised automatically.** The report text, impression and
  consistency flags are all advisory drafts; the radiologist reviews and signs.
* The engine **never invents** findings or negative statements: the impression
  is generated only from documented findings, template normals, and
  indication-matched, documented-negative suggestions.
* Ambiguities (two matching findings for a correction, organ words that
  conflict with the mapped section, un-mappable dictation) are parked in the
  review queue instead of being guessed.
* Measurements, laterality, segment/level, phase and qualifiers are preserved
  verbatim in structured storage and rendered unchanged in professional text.

## 5. Privacy & hospital policy

* Runs entirely locally; the Web Speech engine is Chrome's built-in service
  and sends audio only under your existing browser consent (no API keys, no
  third-party accounts). For fully offline dictation later, swap `speech.js`
  for a WASM engine (Vosk / whisper.cpp) — the interface is already modular.
* The report lives **only in panel memory**; there is no autorun draft
  persistence (health-data minimisation, DPDP-friendly). Templates and debug
  settings, not patient data, are stored in `chrome.storage.local`.
* **New Report / Copy confirm** clears all findings immediately.
* No DICOM/PACS integration, no automated image interpretation, and no action
  is ever taken inside your PACS.

## 6. Extend: templates as data

Open **Templates…** (options page) to import/export/edit JSON templates.
Schema per section:

```jsonc
{
  "id": "liver", "title": "Liver", "organ": "liver",
  "normalStatements": ["Liver is normal in size and attenuation.", "No focal lesion.", "No IHBRD."],
  "slots": [
    { "id": "steat",    "replaceNormal": "normal in size and attenuation" },
    { "id": "lesions",  "replaceNormal": "No focal lesion" }
  ],
  "rules": [
    {
      "id": "hepatic-cyst",
      "matchPhrases": ["simple cyst", "cyst"],
      "slot": "lesions",
      "render": { "default": "A {sizePhrase} simple cyst{qualifierPhrase} is noted {locationPhrase}." },
      "impressionText": "{sizePhrase} simple cyst{qualifierShort} in the liver{locationShort}."
    }
  ]
}
```

Placeholders available in `render` / `impressionText`:

| Token | Example |
| --- | --- |
| `{sizePhrase}` | `5 mm` |
| `{qualifierPhrase}` | ` with thin internal septation` |
| `{sitePhrase}` | `the right kidney` / `both kidneys` |
| `{locationPhrase}` | `in segment V` / `at L4-L5` |
| `{severityAdj}` / `{severityCap}` | `mild` / `Mild` |
| `{phasePhrase}` | ` in the portal venous phase` |

Adding a new organ, study, contrast phase or reporting style is editing this
JSON — no code changes; the engine works against any conforming template.

## 7. Project layout

```
radiology-copilot/
├─ manifest.json          Chrome MV3 extension manifest
├─ background.js          panel toggle (toolbar + keyboard)
├─ sidepanel/             whiteboard UI + speech wrapper + storage
├─ options/               template library editor
├─ engine/                pure ES modules (running in panel + tests):
│   ├─ units.js           numbers/units/romans/spine levels
│   ├─ anatomy.js         organ synonyms, laterality, phases, locations
│   ├─ dictation.js       fragment parser: commands + finding payload
│   ├─ template-engine.js stateful engine (dedupe, corrections, rendering)
│   ├─ impression-generator.js   evidence-grounded impression
│   ├─ consistency-checker.js    contradiction/duplicate/laterality checks
│   └─ report-builder.js  copy-ready plain text
├─ templates/             CECT abdomen, NCCT brain, MRI lumbar spine
└─ tests/                 15 engine tests incl. acceptance examples
```

## 8. Roadmap modules (architecture ready)

* WASM offline speech (Vosk/whisper.cpp) for strict no-transmission sites.
* Structured reporting (RSNA/BIRADS dumps), DICOM measurement panels,
  protocol-specific checklists, multi-language dictation, audit export.
* Optional local Ollama LLM for free-text impression refinement, always
  presented as a draft requiring explicit acceptance.
