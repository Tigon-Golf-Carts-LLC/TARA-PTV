---
name: Overseas imagery audit
description: How to reliably find location-specific imagery in the tara-ev static content mirror
---
Overseas installation photos often have opaque filenames (asdsad17.webp, 1Z5A*.jpg, 微信图片_*.webp), so filename greps miss them.
**Why:** Task reviews rejected the swap twice because images were only findable via alt text ("...at Doha Golf Club") or lightbox `href="/uploads/..."` targets.
**How to apply:** When auditing/replacing imagery in public/content/*.html, grep alt attributes and /uploads hrefs for location terms, swap both the img src AND its wrapping lightbox href, and update alt text to describe the new image. Replacement pool: /images/banner-0*.webp TARA shots.
