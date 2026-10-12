# Show HN (v0.4.1)

- **When**: Tue–Thu, 8–10 am ET (D2 of the launch window). One shot — don't repost for weeks if it flops.
- **Media**: none in the post itself (HN is text); the README hero GIF does the showing. Make sure
  the v0.4.1 release is published first: https://github.com/RGB-loop/Vixel/releases/tag/v0.4.1
- **URL to submit**: https://github.com/RGB-loop/Vixel

## Title (≤ 80 chars, pick one)

1. `Show HN: Vixel – offline AI search for photos and video, jumps to the moment` (77)
2. `Show HN: Fully offline semantic search for your photos, videos and audio` (73)
3. `Show HN: Vixel – local, open-source media search (EmbeddingGemma 2, no cloud)` (78)

## First comment (from the maker — post immediately after submitting)

Hi HN, I built Vixel because I could never find anything in my own media library, and I didn't
want to upload 10 years of family photos to make them searchable.

It's a desktop app (macOS Apple Silicon / Windows x64, MIT) that indexes your existing folders
in place — originals stay read-only — and lets you search by describing what you want:
"sunset at the beach", "rocket launch", "the receipt from March". Video is cut into 32-second
segments, each embedded from frames *and* audio, so a hit opens the player at the matching
segment instead of making you scrub. Text that appears in images or video frames is OCR'd
locally and searchable too. You can also search with an image (paste a frame, find the video
moment it came from).

Everything runs locally: Google DeepMind's EmbeddingGemma 2 via LiteRT-LM on the GPU
(Metal / D3D12), PaddleOCR v5, face clustering, auto-tags — all bundled in the installer
(that's why it's ~600 MB). No account, no telemetry; the renderer's network access is blocked
in code, and the map is a bundled offline basemap. Easiest way to verify: use it with Wi-Fi off.

Things I think HN might find interesting:

- Search quality is measured by a public eval harness in the repo (`evals/`, `npm run eval`) —
  two labelled query sets, with the failures documented in the output, not just the wins.
- The ranking is 4-way RRF (image vectors, segment vectors, OCR BM25, filename) behind an
  adaptive relevance gate: when nothing clears the library's baseline, it says "no confident
  match" instead of padding the grid.
- 0.4.1 added a system-wide quick-search panel (⇧⌘Space / Alt+Shift+Space): Enter opens the
  file at the matching moment, ⌘C puts the actual file on the clipboard, rows drag straight
  into an editor.
- Inference runs in a separate low-priority utilityProcess, bound to LiteRT-LM's C API via
  koffi (no native addon to maintain).

Honest limitations: installers are unsigned for now (macOS: System Settings → Privacy &
Security → Open Anyway; Windows: SmartScreen → Run anyway); the download is big because the
models ship inside; Linux builds but is untested; EPS isn't supported.

Happy to answer anything — and failed queries are the most useful bug reports I can get.

## FAQ (folded in — use as reply bank)

**How is this different from DigUp (Show HN'd recently)?**
Same base model, different trade-offs. Vixel: Windows support, CJK tokenization for exact-text
search (jieba), models bundled so it's offline from first launch (DigUp downloads ~865 MB on
first run and checks for updates daily — its own README says so, and it's disableable), plus an
organizing layer (people, tags, smart albums, similar-photo cleanup, inbox). DigUp covers
document types Vixel doesn't (PDF full-text, code) and is a nice project — pick by need.

**vs Eagle?** Eagle is paid, imports files into its own library, and its AI search covers
images only. Vixel is free/MIT, indexes folders in place, and searches video by segment.
No Eagle-library import — they can coexist.

**vs Immich?** Immich is a self-hosted server for sync/backup — great at that. Vixel is a
desktop app, no server, nothing leaves the machine.

**vs Apple Photos / Spotlight?** They only cover the system Photos library / basic metadata.
Vixel indexes any folder (external drives included), searches inside video with audio, and is
cross-platform.

**Why ~600 MB?** EmbeddingGemma 2 + LiteRT runtime + PaddleOCR + face models are all in the
installer. The cost is the download; the payoff is first-launch offline.

**Why unsigned?** Certificates cost money I haven't spent yet. The code is open — you can
build from source (`npm install && npm run build && npm run package`).

**How do I know it's really offline?** Turn off networking and use it. Or read
`enforceOfflinePolicy` in the source — the renderer can't make requests at all.

**Accuracy numbers?** On our eval set: demo library top-1 1.00, footage library 0.94, with
negatives (queries that *should* return nothing) 5/5 and 4/5. Reproduce with `npm run eval`.
Known misses are printed by the harness. No speed numbers — machines vary too much.

**Linux?** Builds, untested. If you want it, say so in an issue — that's how I prioritize.
