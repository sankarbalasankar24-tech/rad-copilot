# RUN.md — Use Rad-Copilot WITHOUT installing a Chrome extension

The Chrome $5 fee is only for **publishing to the Chrome Web Store** — loading your own
"unpacked" extension in Developer mode is still free, but department systems often disable
Developer mode. So the tool now has a **plain web page build** that needs no extension at all.
Same engine, same tests, same features; the only difference is that configuration lives in
the browser's localStorage instead of `chrome.storage`.

---

## Option A (recommended) — one command, any computer

Rad-Copilot is a folder of static files. Any web server can serve it. Pick whichever you already have:

**Python (present on most lab/department laptops):**
```
cd radiology-copilot
python -m http.server 8000
```
Then open: **http://localhost:8000/webapp/index.html**

**Node.js:**
```
cd radiology-copilot
npx serve -l 8000 .
```

Then open **http://localhost:8000/webapp/index.html**

Also reachable from other machines on the same network:
`python -m http.server 8000 --bind 0.0.0.0`, then open `http://<your-LAN-IP>:8000/webapp/`
on the departmental system's browser.

## Option B — truly one-click, zero installs: GitHub Pages / static hosting

**Is pushing to GitHub safe?** Yes, with the same care as any website:

- The repo contains **only program code and reporting templates** — no patient data, no names,
  no images, no credentials. The report content lives only in the browser of the machine it runs
  on (localStorage keeps settings/templates only, never report content).
- It is **not a secret tool** — it is a reporting helper. The privacy of your patients never
  depends on who can read the code; it depends on where the dictation runs (see the engine
  section below) and where you paste the report.
- The repo is public on GitHub's free plan (private repos need a paid plan to host Pages). If
  you are uncomfortable with the code being public, use Option A (USB copy) instead — or keep
  the repo private and deploy the static files to any free static host that accepts a uploaded
  folder.

**What to bookmark:** after publishing Pages, bookmark
`https://<username>.github.io/<repo>/webapp/index.html` — the *page*, not the repo.

**Do you need to be signed in to GitHub to use it? No.** Viewers of a public Pages URL need no
GitHub account and no sign-in — any browser on any computer just opens the URL. Signing in is
only needed by *you* once, to push updates. This makes it ideal for a department or public PC:
open a normal browser tab, no logins, no accounts.

(Hosted on GitHub Pages for free requires the source repo to be public on GitHub's free plan;
private repos hosting Pages need a paid plan. Even then, everything a public site downloads is
visible to its visitors — so the rule stays: patient data never goes into the code or repo.)

Push this folder to a GitHub repo, enable **Pages** (free), and the tool is then reachable at
`https://<username>.github.io/<repo>/webapp/` from *any* computer with no local server at all.
Everything still runs in your browser — no server compute, no data leaves the machine.
(If you prefer not to use GitHub, any free static host works; upload the `radiology-copilot`
folder's contents untouched.)

## Option C — keep using the Chrome extension

Loading "unpacked" extensions with **Developer mode ON** is still **free** — the $5 fee only
applies to publishing on the Web Store for the public. If this is your personal laptop,
INSTALL.md's original flow continues to work with no payment required.

---

## What works in the web build (no extension)

- template selection, structured dictation → professional report sentences
- medical-vocabulary correction + custom personal vocabulary
- impression generator + consistency checker + copy-to-clipboard (with a fallback
  when the browser blocks `navigator.clipboard`)
- Templates & Settings page (`webapp/settings.html`) with import/export of template JSON
- engine choice: Chrome Web Speech *or* the free local whisper.cpp backend
- the keyboard shortcuts Alt+Shift+S / Alt+Shift+C work inside the page

## Notes & limits

- **Microphone permission** is button-once like normal: the browser will ask per page.
- Clipboard copy of a 200-line report on a non-HTTPS/IP-origin deployment uses a
  `document.execCommand('copy')` fallback; on `localhost` and `https://` the normal
  API is used.
- Templates + *settings* persist in that browser's **localStorage** (they are the only
  things persisted — never the report content). This is a per-browser, per-computer
  store: the department machine will need a one-time personalisation (or import your
  exported `rad-template*.json` files).
- For **fully offline dictation** still see README.md — whisper.cpp backend instructions
  are unchanged.

## Why not Google Drive / Docs / Sheets as the host?

Drive stopped serving hosted web pages in **2016** — you can *store* the folder there and
download it to any PC (a handy free transfer channel), but you cannot *run* the app from
Drive, Docs or Sheets. Google Apps Script could technically host a page, but its sandboxed
iframe does not reliably allow microphone access, and Google Sites embedding has the same
problem — dictation needs `getUserMedia`, which those sandboxes do not guarantee. GitHub
Pages (or any static host) is the free reliable path; Drive remains free as a file-transfer
channel to the department PC.

## Choosing the dictation engine: Google Web Speech vs local whisper.cpp

| | **Google Web Speech** (default) | **Local whisper.cpp** |
|---|---|---|
| Where audio goes | Sent to Google's speech service (needs internet) | Stays on the machine — nothing leaves the PC |
| Speed | Instant, continuous, auto-restarts | ~1–3 s pause per ~9 s segment while transcribing |
| Medical terms | Unvalidated on radiology jargon; free | Same generic model — treat as draft; the correction layer catches common mis-hearings |
| Privacy-conservative | No | Yes — nothing leaves the PC |
| Needs | Chrome/Edge + internet | whisper-server.exe running on the PC (open it before dictating) |

**When to use which:** Google engine during routine work (fast, instant); whisper.cpp when the
study or policy demands zero transmission (e.g. sensitive studies, offline sites, drills).
Both flow through the same medical-vocabulary correction + review-queue safety net.

### Setup for local whisper.cpp (one laptop, ~30 min first time, free)
1. **Prerequisites (one laptop, once):** install Git, CMake and the MSVC C++ build tools
   (all free — "Visual Studio Community + Desktop development with C++" component).
2. Build: clone `github.com/ggml-org/whisper.cpp`, then in a VS Developer PowerShell:
   `cmake -B build -DWHISPER_BUILD_SERVER=ON` and `cmake --build build --config Release -j`
   → produces `build\bin\Release\whisper-server.exe`.
3. Get a model: from the repo root run `models\download-ggml-model.cmd small` (≈466 MB; good
   for 8 GB laptops — use `medium` or `large-v3-turbo` on 16 GB).
4. Start: `build\bin\Release\whisper-server.exe -m models\ggml-small.en.bin -l en --port 8080`
   (add `--convert` if you prefer FFmpeg to convert uploads instead of using our in-browser
   WAV converter).
5. In Rad-Copilot **Templates → Settings**: pick the **Local whisper.cpp** engine, endpoint
   `http://localhost:8080/inference`, then Start as usual. Segments post only to localhost.
6. Test without mic first: `curl.exe http://127.0.0.1:8080/inference -F "file=@test.wav" -F
   "response_format=json"` → expect `{"text":"..."}`.

Switching engines = open **Templates → Settings**, change **Dictation engine**, press Start.
No reinstall; keep both endpoint values saved and flip between them at any time.

