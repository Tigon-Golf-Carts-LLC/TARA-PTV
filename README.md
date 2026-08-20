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
assets-src/images/  SOURCE images (never shipped)
static/             SOURCE static files: css, js, fonts, favicons, feeds
public/             GENERATED — do not edit, do not commit
dist/               GENERATED build output — this is what Pages serves
```

`public/` and `dist/` are both generated and gitignored. Edit page copy in
`content-src/`, images in `assets-src/images/`, everything else in `static/`.

## Scripts

| script | what it does |
| --- | --- |
| `npm run dev` | builds the snapshot, then starts the Vite dev server |
| `npm run build` | fetch-data → generate-seo → optimize-assets → vite build → prerender |
| `npm run build:site` | same, but never touches the network (`SKIP_REMOTE_FETCH=1`) |
| `npm run preview` | serves `dist/` exactly the way GitHub Pages does |
| `npm run verify` | size budget, bundle hygiene, image and route checks |
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
