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


## Series naming
- Official series name is "T1 Golf Cart PTV Series" (renamed site-wide Aug 2026, incl. tooltips like "Tara T1 Golf Cart PTV Series Electric Golf Carts" and routes.json meta description). URL slug stays /t1-series/.
- Merges have reverted renames before — re-grep "T1 Golf Cart Series" (case-insensitive) after every merge.
## PTV keyword naming (Aug 2026)
Client wants "PTV" in series/keyword names site-wide for SEO. Canonical names:
- "T1 Golf Cart PTV Series", "T2 Utility Golf Cart PTV Series", "T3 Street Legal PTV Series"
- "PTV Golf Cart Accessories - Enhance Your Ride with Tara", "Latest News from Tara PTV Golf Carts", "0% Financing on TARA PTV Golf Carts"
**Why:** client wants to rank for the term "ptv"; slugs untouched as usual.
**How to apply:** after any merge, grep for the pre-PTV names and for accidental doubles like "PTV PTV".
