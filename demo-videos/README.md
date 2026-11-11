# ForgeERP — user-guide video series (Hinglish)

Screencast-style tutorials built from the app's own captures in
`docs/manual-screenshots/`. Narration is Hinglish (Hindi in Devanagari + the
English product words you actually see on screen); on-screen captions are
English because the UI is English.

Demo data is **Shree Forge Industries, Pune (FY 2627)**. Your names, GSTINs and
amounts will differ — the buttons and the flow will not.

## The videos

| # | File | Length | What you learn |
|---|------|--------|----------------|
| 00 | `ForgeERP-Pura-Course-Full.mp4` | **13:02** | All 8 chapters joined into one 720p film |
| 01 | `ForgeERP-01-start-here.mp4` | **1:42** | Login, dashboard, Ctrl+K palette, shortcuts, phone view |
| 02 | `ForgeERP-02-masters-setup.mp4` | **1:40** | Company profile, parties, items, warehouses, processes |
| 03 | `ForgeERP-03-sales-gst-invoice.mp4` | **1:41** | GST tax invoice, print, payment, Tally / e-Invoice export, quote-to-cash |
| 04 | `ForgeERP-04-purchase-procurement.mp4` | **1:04** | Supplier bill + input GST, requisition → RFQ → PO → GRN, back orders |
| 05 | `ForgeERP-05-customer-jobwork.mp4` | **1:28** | Inward → Job Card → Certificate → Jobwork invoice (SAC 998887) |
| 06 | `ForgeERP-06-manufacturing.mp4` | **1:59** | Projects, BOM, MRP, work orders, capacity, OEE, costing |
| 07 | `ForgeERP-07-inventory-accounting.mp4` | **1:32** | Stock summary/ledger, lots, adjustments, payments, party ledger, COA |
| 08 | `ForgeERP-08-reports-gst-tally.mp4` | **1:56** | Action Center, GSTR-1 / 3B, trial balance, outstanding, P&L, Tally, audit trail |

Total runtime: **13 minutes 2 seconds** across 8 chapters (56 scenes).

## How to watch / share

* Individual chapters are the short version — safest for WhatsApp / training.
* The full film is one file for YouTube or an onboarding playlist.
* Chapters: 1920×1080 · full film: 1280×720 (small enough to share on WhatsApp).
* All files: 25 fps, H.264 + AAC — plays in any browser, phone, or editor.

## How these were made (re-render anytime)

```bash
cd video-src
pip install pillow imageio-ffmpeg     # ffmpeg ships inside the wheel
python3 render_frames.py              # 56 PNG frames -> video-src/frames/
python3 build_video.py                # -> demo-videos/*.mp4
```

* `script.py` — chapter/scene graph: which screenshot, caption, bullets, spotlight
* `narration.py` — the Hinglish script, one paragraph per scene
* `audio/` — the recorded narration clips (one or two per chapter)
* Scene cuts are snapped to the silences in the narration, so the picture changes
  exactly when the voice moves to the next topic.

Replacing a screenshot or a caption is a one-line edit in `script.py`; the
layout (header, spotlight, progress bar) is generated, so nothing has to be
redone by hand.

## Caveats worth keeping in the video description

* GST reports and e-Invoice JSON are **books working**, not filed returns —
  verify with your CA before uploading to the portal.
* Overhead absorption % is a policy switch; keep it at 0 until the accountant
  signs off.
