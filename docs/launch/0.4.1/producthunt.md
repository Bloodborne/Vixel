# Product Hunt (v0.4.1)

- **When**: launch at 12:01 am PT, Tue–Thu (D3 of the window, after Show HN so the maker
  comment can link both ways). Maker should be around for the first 4–6 hours.
- **Gallery** (in order):
  1. `vixel-0.4.1-en-16x9.mp4` (video slot — English captions)
  2. `shots-en/light-search.png` (semantic search, light)
  3. frame from panel recording (`raw-panel-en.mp4` still — quick search over wallpaper)
  4. `shots-en/dark-video.png` or the seagull detail frame (segment timeline, dark)
  5. `shots-en/light-autotags.png` (auto tags ✦ in inspector)
  6. `shots-en/light-cleanup.png` (similar-photo cleanup)
  7. `shots-en/light-design.png` (PSD/PDF/AI/SVG badges)
  8. `docs/media/social-preview.png` (closing card)
- **Topics**: Artificial Intelligence · Photos · Video · Productivity · Open Source · Privacy
- **Links**: https://github.com/RGB-loop/Vixel · https://github.com/RGB-loop/Vixel/releases/tag/v0.4.1

## Name + tagline (≤ 60 chars)

- Name: **Vixel**
- Tagline options:
  1. `Offline AI search for photos, videos and audio` (47)
  2. `Find the moment in your media — fully offline, free` (51)
  3. `Describe it, find it. No cloud, no account, open source` (55)

## Description

Vixel is a free, open-source desktop app (macOS Apple Silicon / Windows x64) that makes your
existing photo, video, audio and design-file folders searchable by description — "sunset at
the beach", "rocket launch" — and opens videos at the exact matching segment. It reads text
inside images and video frames (local OCR), searches by image, auto-tags offline, groups
people by face, and cleans up near-duplicate photos. Everything runs on your machine: models
are bundled in the installer, there's no account and no telemetry, and it works with Wi-Fi
off. Your files stay where they are, read-only.

## First comment (from the maker)

Hi Product Hunt! Solo dev here.

I built Vixel out of a simple frustration: my photos and footage were all *somewhere*, and no
tool could find them without either months of manual tagging or uploading everything to
someone's cloud.

So Vixel does three things, all locally:

🔎 **Search by describing** — one multilingual model (EmbeddingGemma 2, running on your GPU
via LiteRT) embeds photos, 32-second video segments (frames + audio) and audio files into one
space. A hit on a video opens it at that segment — no scrubbing.

📝 **Search what's written** — local OCR reads screenshots, receipts, signs, even text in
video frames. Works great in English and Chinese.

⌨️ **Search from anywhere** — new in 0.4.1: press ⇧⌘Space (Alt+Shift+Space on Windows) in
any app for a Spotlight-style panel. Enter jumps to the moment; ⌘C copies the actual file;
drag results straight into your editor.

Honest notes: the installer is ~600 MB because every model ships inside (that's what makes it
offline from first launch), and the builds are unsigned for now — macOS needs "Open Anyway"
in Privacy & Security, Windows needs SmartScreen's "Run anyway". MIT licensed; the search
quality is tracked by a public eval harness in the repo, failures included.

I'll be here all day — and "I searched X and expected Y" reports are the most valuable
feedback you can give me.

## Reply bank

- **Pricing?** Free, MIT, no paid tier, no account.
- **iOS/Android?** No — desktop only, by design (your library lives on disks).
- **Linux?** Builds, untested; the issue tracker decides priority.
- **How private really?** Models bundled, renderer network-blocked in code, bundled offline
  map. Verify by using it offline.
- **vs Eagle / Immich / DigUp?** Eagle: paid, import-based, image-only AI. Immich: great
  self-hosted server, needs a server. DigUp: same model family, macOS-only, model downloaded
  on first run; Vixel adds Windows, CJK tokenization, bundled models and organizing features.
  All can coexist.
- **What about RAW/design files?** RAW via embedded previews (CR2/CR3/NEF/ARW/DNG/RAF/ORF/RW2);
  SVG/PSD/PDF/AI indexed via rasterized previews with OCR — on Windows without installing
  Ghostscript or anything else.
