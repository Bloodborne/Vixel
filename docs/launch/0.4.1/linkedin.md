# LinkedIn (v0.4.1 · short)

- **When**: D3–D4, weekday morning (local time). Low priority channel; one post is enough.
- **Media**: `vixel-0.4.1-en-16x9.mp4` (native video upload) or 2 stills (search + quick panel).

## Post

I shipped Vixel v0.4.1 — a free, open-source desktop app that makes your photo, video and
audio folders searchable by plain language, entirely offline.

The problem it solves: media libraries grow faster than anyone's willingness to organize
them. Vixel skips the organizing. It indexes your folders in place (read-only), embeds
images, 32-second video segments (frames + audio) and audio files with a local multimodal
model, OCRs text inside images and video frames, and lets you type "the whiteboard with the
Q3 roadmap" — then opens the video at that exact segment.

What makes it different from cloud AI products: nothing leaves the machine. The models ship
inside the installer, there is no account, and the app's renderer is network-blocked in code.
That architecture matters for anyone handling client footage, internal screenshots or family
photos.

v0.4.1 adds a system-wide quick-search shortcut (⇧⌘Space / Alt+Shift+Space), power-aware
indexing on laptops, and a round of ranking improvements validated by the public eval harness
that ships in the repository.

Free, MIT-licensed, macOS (Apple Silicon) and Windows (x64).
GitHub: https://github.com/RGB-loop/Vixel

#opensource #privacy #localfirst #ai

## Reply bank

- Enterprise/team use → it's a single-user desktop app; MIT license permits internal use freely.
- "Does it train on my data?" → no training, no uploads; inference only, locally.
- Hiring/collab pitches → point to GitHub issues/discussions.
