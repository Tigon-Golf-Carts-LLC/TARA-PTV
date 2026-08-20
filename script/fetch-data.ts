/**
 * fetch-data.ts — build-time data snapshot.
 *
 * The site used to serve its pages through an Express app that read the page
 * mirror at request time and an API server for the inquiry form. GitHub Pages
 * runs no server, so this script resolves everything ONCE, at build time, and
 * writes plain JSON + pre-processed HTML into `public/`:
 *
 *   public/data/routes.json        route table (path → page metadata)
 *   public/data/search-index.json  client-side replacement for /search.php
 *   public/data/products.json      vehicle detail pages (drives prerender)
 *   public/data/news.json          news / blog index
 *   public/data/site.json          contact + form configuration
 *   public/content/*.html          page HTML, base-path and CTA rewritten
 *
 * Optional remote enrichment: when INVENTORY_API_URL is set the script pulls
 * live inventory and merges it into products.json. The API key is read from
 * process.env HERE ONLY and never written to any output file — see the
 * assertSecretsAbsent() guard at the bottom.
 *
 *   npm run build:site  →  SKIP_REMOTE_FETCH=1, no network access required.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  BASE_PATH,
  BASE_PREFIX,
  CONTACT,
  DIRS,
  FORM_ENDPOINT,
  SITE_DOMAIN,
  SITE_NAME,
  SITE_ORIGIN,
  logConfig,
  setStage,
} from './lib/config.js';
import {
  applyBasePath,
  applyContactDetails,
  markLazyImages,
  relativizeSelfLinks,
  replaceSearchForms,
  stripForbidden,
  toPlainText,
} from './lib/html.js';

type RouteMeta = {
  file: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  bodyClass: string;
};
type RouteRedirect = { redirect: string };
type RouteEntry = RouteMeta | RouteRedirect;
type Routes = Record<string, RouteEntry>;

const isRedirect = (e: RouteEntry): e is RouteRedirect => 'redirect' in e;

// ─── Load the source route table ─────────────────────────────────────────────

function loadRoutes(): Routes {
  const p = path.join(DIRS.contentSrc, 'routes.json');
  if (!fs.existsSync(p)) {
    throw new Error(`[fetch-data] route table not found at ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Routes;
}

// ─── Optional third-party enrichment ─────────────────────────────────────────

type LiveInventory = Record<string, { price?: string; inStock?: boolean }>;

async function fetchLiveInventory(): Promise<LiveInventory> {
  const url = process.env.INVENTORY_API_URL;
  if (process.env.SKIP_REMOTE_FETCH === '1' || !url) {
    if (!url) console.log('[fetch-data] INVENTORY_API_URL not set — snapshot built from the local mirror only.');
    else console.log('[fetch-data] SKIP_REMOTE_FETCH=1 — skipping the network fetch.');
    return {};
  }
  // The key never leaves this process: it is used to authenticate the request
  // and is deliberately not copied into any value that gets serialised below.
  const key = process.env.INVENTORY_API_KEY;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as LiveInventory;
    console.log(`[fetch-data] merged live inventory for ${Object.keys(data).length} model(s).`);
    return data;
  } catch (err) {
    // A build must never fail because a third-party endpoint is down; the
    // snapshot simply falls back to the mirrored content.
    console.warn(`[fetch-data] live inventory fetch failed (${(err as Error).message}) — using mirror only.`);
    return {};
  }
}


// ─── Static source tree → public/ ────────────────────────────────────────────

/** Text file types whose contents get base-path / origin rewriting. */
const TEXT_EXT = new Set(['.css', '.xml', '.txt', '.json', '.jsonld', '.kml', '.geojson', '.webmanifest', '.js']);

/** Legacy origins baked into the mirrored feeds and stylesheets. */
const LEGACY_ORIGIN_RE = /https?:\/\/(?:www\.)?tara(?:ptv|golfcart)\.com/gi;

/**
 * Copy `static/` (css, js, fonts, favicons, feeds) into the generated
 * `public/` tree, rewriting internal URLs so they honour BASE_PATH and the
 * configured SITE_DOMAIN. `static/` itself is never shipped directly.
 */
function syncStaticTree(): number {
  let count = 0;
  const walk = (rel: string) => {
    const srcDir = path.join(DIRS.staticSrc, rel);
    for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const childRel = path.join(rel, ent.name);
      const src = path.join(DIRS.staticSrc, childRel);
      const dest = path.join(DIRS.public, childRel);
      if (ent.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        walk(childRel);
        continue;
      }
      const ext = path.extname(ent.name).toLowerCase();
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (TEXT_EXT.has(ext)) {
        let text = fs.readFileSync(src, 'utf8');
        // Vendored JS is copied verbatim: rewriting URL-looking substrings
        // inside a minified bundle corrupts it (`nextEl:` is not a tel: link).
        if (ext === '.js') {
          fs.writeFileSync(dest, text, 'utf8');
          count++;
          continue;
        }
        text = text.replace(LEGACY_ORIGIN_RE, SITE_ORIGIN + BASE_PREFIX);
        text = applyContactDetails(text);
        text = applyBasePath(text);
        fs.writeFileSync(dest, text, 'utf8');
      } else {
        fs.copyFileSync(src, dest);
      }
      count++;
    }
  };
  walk('.');
  return count;
}

// ─── Page classification ─────────────────────────────────────────────────────

function classify(routePath: string): 'product' | 'news' | 'page' {
  if (routePath.includes('-product/')) return 'product';
  if (routePath.startsWith('/news/') || (routePath.startsWith('/blog/') && routePath !== '/blog/')) return 'news';
  return 'page';
}

/** Pull the first <h1> (falling back to the route title) out of a page. */
function firstHeading(html: string): string | null {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? toPlainText(m[1]) : null;
}

/** Pull the publication date out of a news article, if it carries one. */
function articleDate(html: string): string | null {
  const m =
    html.match(/datetime=["'](\d{4}-\d{2}-\d{2})/i) ||
    html.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return m ? (m[1].length === 4 && m[0].length >= 10 ? m[0].slice(0, 10) : m[1]) : null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  logConfig('fetch-data');

  const routes = loadRoutes();
  const inventory = await fetchLiveInventory();

  // `public/` is entirely generated — wipe it so no stale output survives.
  fs.rmSync(DIRS.public, { recursive: true, force: true });
  fs.mkdirSync(DIRS.publicContent, { recursive: true });
  fs.mkdirSync(DIRS.publicData, { recursive: true });

  const staticFiles = syncStaticTree();
  console.log(`[fetch-data] staged ${staticFiles} file(s) from static/ → public/`);

  const snapshotRoutes: Routes = {};
  const searchIndex: Array<{ p: string; t: string; d: string; k: string }> = [];
  const products: Array<Record<string, unknown>> = [];
  const news: Array<Record<string, unknown>> = [];
  const forbiddenHits: string[] = [];

  let pages = 0;
  let redirects = 0;

  for (const [routePath, entry] of Object.entries(routes)) {
    if (isRedirect(entry)) {
      snapshotRoutes[routePath] = { redirect: entry.redirect };
      redirects++;
      continue;
    }

    const srcFile = path.join(DIRS.contentSrc, entry.file);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`[fetch-data] content file missing for "${routePath}": ${entry.file}`);
    }

    let html = fs.readFileSync(srcFile, 'utf8');

    // 1. Never ship the markup the client asked to have deleted.
    const guarded = stripForbidden(html);
    if (guarded.removed.length) forbiddenHits.push(`${entry.file}: ${guarded.removed.join(', ')}`);
    html = guarded.html;

    // 2. Single dealership email + phone everywhere.
    html = applyContactDetails(html);

    // 3. /search.php needs PHP — point the form at the static search page.
    html = replaceSearchForms(html);

    // 3b. Absolute self-links → relative, so BASE_PATH applies to them too.
    html = relativizeSelfLinks(html);

    // 4. Lazy-load by default (optimize-assets adds dimensions + srcset).
    html = markLazyImages(html);

    // 5. Honour BASE_PATH on every internal URL.
    html = applyBasePath(html);

    fs.writeFileSync(path.join(DIRS.publicContent, entry.file), html, 'utf8');

    // The frontend reads exactly these six fields — nothing else is emitted.
    snapshotRoutes[routePath] = {
      file: entry.file,
      title: entry.title,
      description: entry.description,
      image: entry.image,
      imageAlt: entry.imageAlt,
      bodyClass: entry.bodyClass || '',
    };
    pages++;

    const text = toPlainText(html);
    searchIndex.push({
      p: routePath,
      t: entry.title,
      d: entry.description,
      // Keywords only — the full body would bloat the index past a megabyte.
      k: text.slice(0, 600),
    });

    const kind = classify(routePath);
    if (kind === 'product') {
      const slug = routePath.replace(/^\/|\/$/g, '');
      products.push({
        path: routePath,
        slug,
        name: firstHeading(html) || entry.title.split('|')[0].trim(),
        title: entry.title,
        description: entry.description,
        image: entry.image,
        imageAlt: entry.imageAlt,
        ...(inventory[slug] ?? {}),
      });
    } else if (kind === 'news') {
      news.push({
        path: routePath,
        title: entry.title.split('|')[0].trim(),
        description: entry.description,
        image: entry.image,
        date: articleDate(html),
      });
    }
  }

  // ─── Emit the snapshot (minified — no pretty-printing) ─────────────────────

  const siteConfig = {
    name: SITE_NAME,
    domain: SITE_DOMAIN,
    base: BASE_PATH,
    email: CONTACT.email,
    phone: CONTACT.phoneDisplay,
    phoneHref: CONTACT.phoneHref,
    // Rewritten to the optimised derivative by script/optimize-assets.ts.
    logo: '/images/tara-ptv-logo.png',
    // Public third-party endpoint (Formspree). Not a secret — it is designed
    // to be called from the browser. Empty string ⇒ the form falls back to a
    // prefilled mailto: link.
    formEndpoint: FORM_ENDPOINT,
  };

  const outputs: Array<[string, unknown]> = [
    ['routes.json', snapshotRoutes],
    ['search-index.json', searchIndex],
    ['products.json', products],
    ['news.json', news.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))],
    ['site.json', siteConfig],
  ];

  for (const [name, value] of outputs) {
    const json = JSON.stringify(value);
    assertSecretsAbsent(name, json);
    fs.writeFileSync(path.join(DIRS.publicData, name), json, 'utf8');
    console.log(`[fetch-data] wrote data/${name} (${(json.length / 1024).toFixed(1)} KB)`);
  }

  if (forbiddenHits.length) {
    console.warn(`[fetch-data] stripped client-removed markup from ${forbiddenHits.length} file(s):`);
    for (const h of forbiddenHits.slice(0, 10)) console.warn(`  - ${h}`);
  }

  setStage('staged');

  console.log(
    `[fetch-data] snapshot complete: ${pages} page(s), ${redirects} redirect(s), ` +
      `${products.length} product(s), ${news.length} article(s).`,
  );
}

/** Hard guard: no build secret may ever appear in a file we ship. */
function assertSecretsAbsent(name: string, json: string) {
  const secrets = [process.env.INVENTORY_API_KEY, process.env.GITHUB_TOKEN].filter(
    (v): v is string => typeof v === 'string' && v.length > 8,
  );
  for (const secret of secrets) {
    if (json.includes(secret)) {
      throw new Error(`[fetch-data] SECURITY: a secret value leaked into data/${name} — aborting build.`);
    }
  }
}

main().catch((err) => {
  console.error('[fetch-data] fatal:', err);
  process.exit(1);
});
