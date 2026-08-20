# TARA Personal Transportation Vehicles — static site

A 100% static build of taraptv.com, deployable to GitHub Pages. There is no
server, no API and no database: every page is a real HTML file generated at
build time.

Contact CTA site-wide: **taradealership@gmail.com** · **1-844-844-3432**

## Layout

```
index.html          app shell (uses %BASE_URL% so BASE_PATH works everywhere)
src/                frontend — React shell + imperative page activation
script/             build pipeline (TypeScript, run with tsx)
  fetch-data.ts       build-time data snapshot + page HTML processing
  generate-seo.ts     sitemap.xml, section sitemaps, robots.txt
  optimize-assets.ts  image pipeline, CSS/JS minification
  prerender.ts        one real index.html per route + 404/.nojekyll/CNAME
  serve-dist.ts       static preview server (mimics GitHub Pages)
  verify.ts           pre-deploy gate
content-src/        SOURCE page HTML (579 files) + routes.json
assets-src/images/  SOURCE images, compressed masters (never shipped)
static/             SOURCE static files: css, js, fonts, favicons, feeds
public/             GENERATED — do not edit, do not commit
dist/               GENERATED build output — this is what Pages serves
```

`public/` and `dist/` are both generated and gitignored. Edit page copy in
`content-src/`, images in `assets-src/images/`, everything else in `static/`.

### Image sources

The mirror arrived with 1.3 GB of originals — 10 MB PNG photographs, EXIF
intact, some 4000 px wide — which is repository weight and nothing else: no
page serves an image above 1600 px. `script/compress-sources.ts` rewrote them
as WebP masters capped at 2000 px, taking `assets-src/` from **1,256 MB to
304 MB**.

Masters are named after the file they replaced, with the original extension
folded into the stem:

```
2+2-pass-golf-cart-color-sky-blue.png → 2+2-pass-golf-cart-color-sky-blue_png.webp
harmony250626.webp                    → harmony250626_webp.webp
```

That encoding matters: the mirror has 519 stem collisions (a `foo.jpg` and a
`foo.webp` of the same photo), which a plain `.webp` rename would silently
merge. Page HTML still refers to the original file name and
`script/optimize-assets.ts` resolves it through the same mapping, so no
content file changed and no delivered URL moved.

**Adding new images:** drop them in `assets-src/images/` under any name, then
run `npm run compress:sources`. It only touches files not already in
canonical form, so masters are never re-encoded and never lose a generation.

## Scripts

| script | what it does |
| --- | --- |
| `npm run dev` | builds the snapshot, then starts the Vite dev server |
| `npm run build` | fetch-data → generate-seo → optimize-assets → vite build → prerender |
| `npm run build:site` | same, but never touches the network (`SKIP_REMOTE_FETCH=1`) |
| `npm run preview` | serves `dist/` exactly the way GitHub Pages does |
| `npm run verify` | size budget, bundle hygiene, image and route checks |
| `npm run compress:sources` | re-compress any new image source to a WebP master (`-- --dry` to preview) |
| `npm run typecheck` | `tsc --noEmit` |

The first `npm run build` encodes ~1,000 images and takes several minutes.
Results are cached in `.cache/images/`, so later builds only re-encode what
changed. CI restores that cache (see the workflow).

## Configuration

Everything is environment-driven — see `.env.example`.

| variable | default | meaning |
| --- | --- | --- |
| `BASE_PATH` | `/` | `/` for a custom domain or `<user>.github.io`; `/<repo-name>/` for a project site |
| `SITE_DOMAIN` | `taraptv.com` | bare domain for canonical URLs, sitemaps, OG tags and `CNAME` |
| `FORMSPREE_ENDPOINT` | *(empty)* | contact-form endpoint; empty ⇒ the form falls back to `mailto:` |
| `INVENTORY_API_URL` / `INVENTORY_API_KEY` | *(empty)* | optional live-inventory enrichment, read **only** by `script/fetch-data.ts` |
| `ENABLE_AVIF` | `0` | emit AVIF and wrap images in `<picture>` |

`BASE_PATH` is the setting that breaks Pages deployments. Nothing hardcodes
`/assets/...`: the shell uses `%BASE_URL%`, the frontend derives URLs from
`import.meta.env.BASE_URL`, and `script/fetch-data.ts` rewrites every
root-absolute URL inside the mirrored page HTML and CSS.

## Deploying

Push to `main`. `.github/workflows/deploy.yml` builds and publishes. Set
**Settings → Pages → Source** to **GitHub Actions** once, and change
`BASE_PATH` / `SITE_DOMAIN` in the workflow's `env:` block if the hosting
target changes.

## What is not static

* **Contact form** — posts to Formspree, or opens a prefilled `mailto:` when
  `FORMSPREE_ENDPOINT` is unset. There is no server-side delivery.
* **Search** — the theme's `/search.php` form is rewritten to `/search/`,
  which searches `data/search-index.json` in the browser.
* **Redirects** — Pages cannot issue a 301, so the 60 alias URLs are emitted
  as canonical-tagged meta-refresh stubs.
