---
name: PTV rebrand conventions
description: Rules from the Aug 2026 rebrand to TARA Personal Transportation Vehicles / taraptv.com
---

The site was rebranded site-wide: "Neighborhood Electric Vehicle(s)"/NEV(s) → "Personal Transportation Vehicle(s)"/PTV(s), brand "TARA Electric Vehicles" → "TARA Personal Transportation Vehicles", domains taragolfcart.com / taragolfcarts.com / **taranev.com** → taraptv.com.

**Why:** client request; keyword is "TARA Personal Transportation Vehicles".

**How to apply:**
- Page URL slugs were intentionally left unchanged (e.g. `/news/neighborhood-electric-vehicles/`, `news__nev-golf-cart-...`) — do NOT "fix" them, and do not flag them in audits.
- Three legacy domains exist in history; when scanning after merges, grep for all of `taragolfcart`, `taragolfcarts`, `taranev` — the prerender fallback origin in `vite.config.ts` and `scripts/prerender.mjs` had a hardcoded old domain once.
- Logo file is `tara-ptv-logo.png` (old `tara-nev-logo.png` image still on disk and its raster art still shows "NEV" — replacing the artwork is an open follow-up).
- `dist/` is stale build output; ignore it in scans.
- Re-run this brand/domain grep after every task merge (merges have restored removed/old content before).
