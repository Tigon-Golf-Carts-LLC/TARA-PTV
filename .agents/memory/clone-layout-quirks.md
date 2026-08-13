---
name: Clone layout quirks
description: Non-obvious layout/DOM behaviors of the cloned static site that break injected UI
---
- The cloned `.container` computes to exactly 100vh with content overflowing it; anything appended after it lands just below the fold and looks "missing". site.css overrides it to `height:auto !important`.
  **Why:** the site-wide footer injected by App.tsx was invisible in every screenshot until this override.
  **How to apply:** if injected elements seem absent, log `getBoundingClientRect()` first — they may just be pushed below the viewport by a fixed-height ancestor.
- Injected site-wide UI (footer `#tara-footer`, Call Now `#tara-call-now`) is appended by App.tsx after content load; footer goes inside the content container (body end holds JS-injected mobile drawers).
- Balanced-tag removal scripts must match the real tag (flags are `<li>`, accordion is `<div>`); FAQ/recall/tech-support pages use the same `fl-module-accordion` markup as product specs — exclude non-product pages from spec-accordion removals.
