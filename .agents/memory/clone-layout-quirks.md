---
name: Clone layout quirks
description: Non-obvious layout/DOM behaviors of the cloned static site that break injected UI
---
- The cloned `.container` computes to exactly 100vh with content overflowing it; anything appended after it lands just below the fold and looks "missing". site.css overrides it to `height:auto !important`.
  **Why:** the site-wide footer injected by App.tsx was invisible in every screenshot until this override.
  **How to apply:** if injected elements seem absent, log `getBoundingClientRect()` first — they may just be pushed below the viewport by a fixed-height ancestor.
- Injected site-wide UI (footer `#tara-footer`, Call Now `#tara-call-now`) is appended by App.tsx after content load; footer goes inside the content container (body end holds JS-injected mobile drawers).
- Desktop Vehicles mega-menu: per-series product panels are absolute full-width; if any panel is forced visible (e.g. `display:flex !important` unscoped), it covers the sibling series tabs and they look "deleted". Panels must stay hidden except `li.active` / `li:focus-within`, and the series tab `ul` must be a nowrap centered flex row or tabs stack behind the panel.
  **Why:** an unscoped flex rule made T2/T3 tabs invisible despite being present and "visible" in the DOM — the user reported them as missing repeatedly.
  **How to apply:** for "missing menu item" reports, check `getBoundingClientRect()` of the item AND what element paints on top of it; grep in-DOM markup first (it was always intact).
- Balanced-tag removal scripts must match the real tag (flags are `<li>`, accordion is `<div>`); FAQ/recall/tech-support pages use the same `fl-module-accordion` markup as product specs — exclude non-product pages from spec-accordion removals.
