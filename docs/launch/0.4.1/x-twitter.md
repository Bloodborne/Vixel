# X / Twitter (v0.4.1)

- **When**: launch thread on D2, right after Show HN goes up (cross-pollinate); standalone
  posts spread over the following week.
- **Media**: thread post 1 → `vixel-0.4.1-demo.gif` (5.8 MB, under X's 15 MB GIF limit) or the
  en 16:9 mp4; others as noted.
- **Hashtags**: use sparingly — #opensource #localfirst at most. Links: github.com/RGB-loop/Vixel

## Launch thread (7 posts)

**1/** (attach GIF or en mp4)
I spent 6 months making my photo & footage library searchable without uploading a single byte.

Vixel: free, open-source, fully offline AI search for photos, videos and audio.
Type "rocket launch" → it opens the video at that exact second.

github.com/RGB-loop/Vixel 🧵

**2/** (attach quick-panel still)
New in v0.4.1: search from any app.

⇧⌘Space (Alt+Shift+Space on Windows) opens a Spotlight-style panel over your whole library.
↩ opens the file at the matching moment. ⌘C copies the actual file. Rows drag straight into
your editor's timeline.

**3/** (attach video.jpg still)
Videos aren't one blob: every 32 seconds becomes its own search unit, embedded from frames
*and* audio. "Dog barking on the beach" matches what was seen and what was heard — and the
player opens right there, timeline highlighted.

**4/** (attach ocr.jpg still)
The text in your screenshots, receipts, signs — even text that flashes by in a video frame —
is OCR'd locally and searchable. English and Chinese both work well (PaddleOCR v5 + proper
CJK tokenization).

**5/**
When nothing really matches, it says so.

Search results pass an adaptive relevance gate instead of padding the page with lookalikes.
The gate is tuned against a public eval harness that ships in the repo — including its
failures. `npm run eval` reproduces every number.

**6/**
The privacy part isn't a toggle, it's architecture:
- all models inside the installer (~600 MB, that's the trade)
- renderer network access blocked in code
- offline bundled map
- no account, no telemetry

Turn off Wi-Fi and everything still works.

**7/**
Free, MIT, macOS (Apple Silicon) + Windows (x64).

Installers are unsigned for now — macOS: Privacy & Security → "Open Anyway";
Windows: SmartScreen → "Run anyway". Or build from source.

⬇️ github.com/RGB-loop/Vixel/releases/tag/v0.4.1
Failed searches are the best bug reports. Try to stump it.

## Standalone posts (spread over the week)

**A — the honest-search angle** (attach search-nomatch screenshot)
Unpopular product decision: when my search engine isn't confident, it shows *nothing* and
says so. No padding the grid with vaguely similar photos. Users trust the top result more
when an empty state is possible. Eval harness keeps us honest: github.com/RGB-loop/Vixel

**B — the engineering angle** (attach architecture sketch or repo link card)
Running Google's EmbeddingGemma 2 inside Electron: LiteRT-LM C API via koffi, inference in a
low-priority utilityProcess, vectors in sqlite-vec next to FTS5 in one SQLite file. No
server, no Python, no native addon. Write-up in the repo's docs/review/.

**C — the "find the moment" angle** (attach GIF)
Your footage folder, but you can type "the shot where the train pulls in" and be *on that
frame* three seconds later. Fully offline, free, open source. macOS + Windows.
github.com/RGB-loop/Vixel

## Reply bank

- "Model?" → EmbeddingGemma 2 (768d, multilingual, multimodal) on LiteRT-LM, GPU w/ CPU fallback.
- "Battery?" → 0.4.1 is power-aware: big backfills wait on battery/low-power/thermal; new
  files still index immediately.
- "iCloud Photos?" → index any folder; cloud-only placeholder files are detected and never
  force-downloaded.
- "Signed builds when?" → when the cert budget happens; source builds today.
