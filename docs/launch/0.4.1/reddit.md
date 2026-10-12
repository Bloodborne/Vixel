# Reddit (v0.4.1) — per-sub drafts

> **Before posting, re-read each sub's sidebar rules.** Reddit was unreachable from the drafting
> machine, so the rule summaries below are from memory and may be stale. General hygiene that is
> always true: post from the account with real comment history, disclose that you're the
> developer in the first line, answer every comment for the first few hours, never post the same
> text to two subs on the same day, and keep self-promo well under ~10% of your account activity.

- **When**: D2–D3, staggered one sub per day, 9–11 am US Eastern.
- **Media**: Reddit video upload of `vixel-0.4.1-en-16x9.mp4` where allowed, else the GIF;
  link to https://github.com/RGB-loop/Vixel (release: /releases/tag/v0.4.1).

---

## r/macapps — D2

*Rules check (from memory):* developer self-posts are generally welcome here if you disclose and
engage; this is the friendliest sub on the list. Verify the sidebar anyway.

**Title options**

1. [Dev] Vixel — free, open-source, fully offline AI search for photos, videos and audio (jumps to the exact moment in a video)
2. [Dev] I built a fully offline semantic search for my media library — v0.4.1 adds a system-wide quick-search panel

**Body**

Developer here. Vixel indexes your existing folders in place (read-only) and lets you search by
describing the content: "sunset at the beach", "rocket launch". Videos are embedded in
32-second segments (frames + audio), so results open at the matching moment. Text inside
images and video frames is OCR'd locally; you can also search with an image.

New in 0.4.1: a Spotlight-style panel on ⇧⌘Space from any app — Enter opens at the moment,
Space Quick Look, ⌘C copies the actual file, and rows drag straight into an editor. Also:
indexing now waits politely on battery / Low Power Mode / thermal pressure, and the crawler
skips credential files, app bundles and cloud-only placeholder files (never triggers an
iCloud download).

Fully offline: models are bundled (hence the ~600 MB download), no account, no telemetry —
works with Wi-Fi off. Free, MIT. macOS is Apple Silicon only for now; the build is unsigned,
so first launch needs System Settings → Privacy & Security → "Open Anyway".

GitHub: https://github.com/RGB-loop/Vixel

**Reply bank**: Intel Mac → no installer yet, +1 the issue. Photos.app library → index any
folder; exporting from Photos is recommended (it skips .photoslibrary bundles by design).
Battery worries → power-aware indexing is new in 0.4.1, and there's a toggle.

---

## r/DataHoarder — D3

*Rules check (from memory):* tools posts are fine if genuinely useful and non-commercial;
disclose affiliation; no referral/sales links. Verify the sidebar.

**Title options**

1. Open-source, fully offline semantic search over local photo/video/audio hoards (no cloud, no account, models bundled)
2. I made a local-only AI index for media drives: describe a clip, jump to the second it happens

**Body**

Fellow hoarder of a few TB of photos/footage. I wrote Vixel because I wanted my drives
searchable without anything touching a cloud.

What it does for a hoard: point it at folders (originals stay read-only — it never moves or
rewrites files), it builds thumbnails + embeddings + OCR into its own SQLite database, and you
search in natural language across images, video *segments* (frames + audio per 32 s) and audio
files. Content-hash dedup means the same file in five folders is indexed once. It deliberately
skips machine-generated dataset dirs (frame_000042 …), node_modules, app bundles, credential
files — and never triggers a download of cloud-only placeholders (iCloud / OneDrive stubs are
detected and left alone).

Scale notes honestly: it's a desktop app, tested on libraries in the tens-of-thousands range,
not a server product; first index of a big drive takes a while (models run locally on GPU).
CLI with `--json` exists for scripting. Free, MIT, macOS (Apple Silicon) + Windows (x64).
~600 MB installer because all models are inside; unsigned for now (SmartScreen → Run anyway).

GitHub: https://github.com/RGB-loop/Vixel

**Reply bank**: Linux → builds, untested; vote on the issue. NAS → index a mounted share
works, but indexing reads every file once, mind the network. "Why not Immich" → Immich is a
server for backup/sync, this is a no-server desktop index; different jobs, both open source.

---

## r/VideoEditing — D3 or D4 (⚠️ check rules first)

*Rules check (from memory):* r/VideoEditing restricts self-promotion — historically it required
prior mod approval for tool posts. **Message the mods first** with a one-paragraph description
and the GitHub link, and only post if they approve. If they don't, skip — r/editors is even
stricter (explicitly "no self-promotion, we're not your focus group") — **do not post a launch
thread in r/editors at all**; only mention Vixel there if someone asks for exactly this in an
existing thread, with disclosure.

**Title (if approved)**

1. Free open-source tool: type "rocket launch", jump to that second in your footage folder — fully offline
2. I built an offline semantic search for footage folders (finds the moment, drags into your NLE)

**Body (if approved)**

Developer, with mod approval. Vixel indexes a footage folder in place and lets you search
shots by describing them — including what's *audible* — and opens the clip at the matching
32-second segment. On-screen text (signs, slates, subtitles) is OCR'd and searchable. Paste a
frame to find which clip it came from. A global shortcut panel (⇧⌘Space / Alt+Shift+Space)
searches from inside your NLE, and results drag onto the timeline as real files.

It's free (MIT), fully offline (models bundled, nothing uploads — your client footage never
leaves the machine), macOS Apple Silicon + Windows x64. Unsigned installers for now.
Proxies/NLE integration beyond drag & drop: not yet — it's a finder, not a MAM.

GitHub: https://github.com/RGB-loop/Vixel

---

## r/opensource — D4

*Rules check (from memory):* sharing your own OSS is on-topic; the project must actually be
open source (it is: MIT, full source, no open-core tricks); avoid pure release-notes spam.

**Title**

1. Vixel — MIT-licensed offline AI search for photos/video/audio (EmbeddingGemma 2 + sqlite-vec + Electron)
2. Built a fully offline media search app; search quality is tracked by a public eval harness in the repo

**Body**

MIT desktop app, macOS (AS) + Windows. Natural-language search over images, video segments
(frames + audio) and audio; local OCR (PaddleOCR v5) with proper CJK tokenization; faces,
auto-tags, smart albums, similar-photo cleanup; everything offline — models ship in the
installer, the renderer's network access is blocked in code.

The part I'd highlight for this sub: retrieval quality is governed by a public eval harness
(`evals/`, `npm run eval`) — two labelled query sets with per-query diffs against a baseline,
and the known failures are printed, not hidden. Ranking changes only land if the harness
doesn't regress. Stack: Electron, better-sqlite3 + sqlite-vec + FTS5, LiteRT-LM via koffi,
sharp, ffmpeg. Contributions and bad-case reports welcome.

GitHub: https://github.com/RGB-loop/Vixel

---

## r/software — D4

*Rules check (from memory):* general software sub; self-promo is tolerated if clearly useful,
disclosed and not spammy. Verify.

**Title**

1. Vixel (free, open source): offline AI search for your photo/video library — Windows and macOS
2. A local "search by describing it" app for photos and videos — no cloud, no account, free

**Body**

Short version: describe what's in the photo or video ("fireworks", "the whiteboard with the
roadmap"), get the file — videos open at the exact matching segment. Text inside
images/frames is searchable (local OCR). Fully offline: the AI models are inside the ~600 MB
installer, no account, nothing uploads. Free and open source (MIT). Windows x64 and macOS
Apple Silicon. Unsigned for now — SmartScreen will warn; "More info → Run anyway", or build
from source.

GitHub: https://github.com/RGB-loop/Vixel

---

## Shared reply bank (all subs)

- **"Spyware until proven otherwise"** → fair default. It works with networking off; the
  renderer can't make requests (see `enforceOfflinePolicy`); no account, no telemetry. Source
  is MIT — audit or build it yourself.
- **"Accuracy?"** → public eval harness in the repo (`npm run eval`): demo set top-1 1.00,
  footage set 0.94, negatives 5/5 and 4/5 on our eval set; failures are listed in the output.
  No speed numbers on purpose.
- **"vs DigUp"** → same base model, different trade-offs: Vixel has Windows, CJK word
  segmentation, bundled models (offline from first launch; DigUp fetches ~865 MB on first run
  and checks updates daily per its README), plus organizing (people/tags/albums/cleanup).
  DigUp covers PDFs/code. Both MIT — pick by need.
- **"vs Eagle"** → Eagle: paid, import-based, image-only AI search, mature collect/organize
  chain. Vixel: free, in-place, video segments + audio. No Eagle-library import; they coexist.
- **"Electron 🙄"** → the heavy lifting is SQLite + native inference in a separate process;
  Electron is the shell. Happy to trade that criticism for a shipped cross-platform app.
