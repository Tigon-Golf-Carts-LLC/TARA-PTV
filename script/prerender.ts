/**
 * prerender.ts — turns the SPA into a directory of real HTML files.
 *
 * Runs AFTER `vite build`. For every route in the snapshot it writes
 * `dist/<slug>/index.html` containing:
 *
 *   • the built shell (hashed JS/CSS bundles, so nothing is re-downloaded)
 *   • per-page <title>, description, canonical, OG and Twitter tags
 *   • the page's HTML inlined into #page, so the URL is directly linkable
 *     and crawlable with JavaScript disabled
 *   • window.__TARA__ with that route's metadata, so the client makes ZERO
 *     data requests on a normal page view
 *
 * It also finishes the deploy artifact: 404.html, .nojekyll, CNAME, and
 * meta-refresh stubs for the 60 alias URLs the Express server used to 301.
 */
import fs from 'node:fs';
import path from 'node:path';

import { minify } from 'html-minifier-terser';

import {
  BASE_PATH,
  BASE_PREFIX,
  DIRS,
  IS_CUSTOM_DOMAIN,
  SITE_DOMAIN,
  SITE_NAME,
  SITE_ORIGIN,
  logConfig,
} from './lib/config.js';
import { escHtml } from './lib/html.js';

type RouteMeta = {
  file: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  bodyClass: string;
};
type RouteRedirect = { redirect: string };
type Routes = Record<string, RouteMeta | RouteRedirect>;

const isRedirect = (e: RouteMeta | RouteRedirect): e is RouteRedirect => 'redirect' in e;

const MINIFY_OPTS = {
  collapseWhitespace: true,
  conservativeCollapse: true,
  removeComments: true,
  removeRedundantAttributes: false,
  minifyCSS: true,
  minifyJS: true,
  keepClosingSlash: true,
  // The mirrored WordPress markup has genuine quirks (literal `<<` and `>>`
  // in the pagination). Browsers render them; the strict parser would not.
  continueOnParseError: true,
};

// ─── <head> rewriting ────────────────────────────────────────────────────────

function setTag(html: string, pattern: RegExp, replacement: string): string {
  return pattern.test(html) ? html.replace(pattern, replacement) : html.replace('</head>', `${replacement}</head>`);
}

function buildHead(html: string, routePath: string, meta: RouteMeta): string {
  const canonicalUrl = `${SITE_ORIGIN}${BASE_PREFIX}${routePath}`;
  const image = meta.image.startsWith('http') ? meta.image : `${SITE_ORIGIN}${meta.image}`;
  const title = meta.title || SITE_NAME;
  const description = meta.description || '';
  const alt = meta.imageAlt || title;

  let out = html;
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escHtml(title)}</title>`);
  const tags: Array<[RegExp, string]> = [
    [/<meta\s+name="title"[^>]*>/i, `<meta name="title" content="${escHtml(title)}" />`],
    [/<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${escHtml(description)}" />`],
    [/<meta\s+name="image"[^>]*>/i, `<meta name="image" content="${escHtml(image)}" />`],
    [/<meta\s+property="og:title"[^>]*>/i, `<meta property="og:title" content="${escHtml(title)}" />`],
    [/<meta\s+property="og:description"[^>]*>/i, `<meta property="og:description" content="${escHtml(description)}" />`],
    [/<meta\s+property="og:image"[^>]*>/i, `<meta property="og:image" content="${escHtml(image)}" />`],
    [/<meta\s+property="og:image:alt"[^>]*>/i, `<meta property="og:image:alt" content="${escHtml(alt)}" />`],
    [/<meta\s+property="og:url"[^>]*>/i, `<meta property="og:url" content="${escHtml(canonicalUrl)}" />`],
    [/<meta\s+property="og:type"[^>]*>/i, `<meta property="og:type" content="${routePath.startsWith('/news/') || routePath.startsWith('/blog/') ? 'article' : 'website'}" />`],
    [/<meta\s+name="twitter:title"[^>]*>/i, `<meta name="twitter:title" content="${escHtml(title)}" />`],
    [/<meta\s+name="twitter:description"[^>]*>/i, `<meta name="twitter:description" content="${escHtml(description)}" />`],
    [/<meta\s+name="twitter:image"[^>]*>/i, `<meta name="twitter:image" content="${escHtml(image)}" />`],
    [/<meta\s+name="twitter:image:alt"[^>]*>/i, `<meta name="twitter:image:alt" content="${escHtml(alt)}" />`],
    [/<link\s+rel="canonical"[^>]*>/i, `<link rel="canonical" href="${escHtml(canonicalUrl)}" />`],
  ];
  for (const [pattern, replacement] of tags) out = setTag(out, pattern, replacement);
  return out;
}

// ─── Page assembly ───────────────────────────────────────────────────────────

function buildPage(shell: string, routePath: string, meta: RouteMeta, content: string, site: unknown): string {
  let html = buildHead(shell, routePath, meta);

  if (meta.bodyClass) {
    html = html.replace(/<body(\s[^>]*)?>/i, (m, attrs = '') =>
      /class=/i.test(attrs ?? '')
        ? m.replace(/class=(["'])([\s\S]*?)\1/i, (_x, q, v) => `class=${q}${v} ${meta.bodyClass}${q}`)
        : `<body${attrs ?? ''} class="${escHtml(meta.bodyClass)}">`,
    );
  }

  // The page markup goes into #page, which sits OUTSIDE the React root so
  // that mounting React never throws the prerendered HTML away.
  html = html.replace('<div id="page"></div>', `<div id="page" data-prerendered="1">${content}</div>`);

  // Inline this route's snapshot record so the client issues no data request.
  const inline =
    `<script>window.__TARA__=${JSON.stringify({ path: routePath, route: meta, site }).replace(/</g, '\\u003c')}</script>`;
  html = html.replace('</body>', `${inline}</body>`);
  return html;
}

/** GitHub Pages cannot issue a 301, so alias URLs get a meta-refresh stub
 *  that also carries rel=canonical for crawlers. */
function buildRedirectPage(from: string, to: string): string {
  const target = `${BASE_PREFIX}${to}`;
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<title>Redirecting…</title><link rel="canonical" href="${escHtml(SITE_ORIGIN + target)}">` +
    `<meta name="robots" content="noindex,follow">` +
    `<meta http-equiv="refresh" content="0; url=${escHtml(target)}">` +
    `<script>location.replace(${JSON.stringify(target)})</script></head>` +
    `<body><p>This page moved to <a href="${escHtml(target)}">${escHtml(to)}</a>.</p></body></html>`
  );
}

function outPathFor(routePath: string): string {
  const slug = routePath === '/' ? '' : routePath.replace(/^\/|\/$/g, '');
  return slug ? path.join(DIRS.dist, ...slug.split('/'), 'index.html') : path.join(DIRS.dist, 'index.html');
}

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  logConfig('prerender');

  const shellPath = path.join(DIRS.dist, 'index.html');
  if (!fs.existsSync(shellPath)) {
    throw new Error(`[prerender] built shell not found at ${shellPath} — run \`vite build\` first.`);
  }
  const shell = fs.readFileSync(shellPath, 'utf8');
  if (/src=["'][^"']*\/src\/main\.tsx["']/.test(shell)) {
    throw new Error('[prerender] the shell still references /src/main.tsx — this is the source index.html, not the build output.');
  }
  const bundleMatch = shell.match(/src=["']([^"']+\.js)["']/);
  if (!bundleMatch) {
    throw new Error('[prerender] the built shell has no <script src="…js"> tag.');
  }
  const bundlePath = path.join(DIRS.dist, bundleMatch[1].replace(BASE_PREFIX, '').replace(/^\//, ''));
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`[prerender] the shell references ${bundleMatch[1]} but ${bundlePath} does not exist.`);
  }

  const routes: Routes = JSON.parse(fs.readFileSync(path.join(DIRS.dist, 'data', 'routes.json'), 'utf8'));
  const site = JSON.parse(fs.readFileSync(path.join(DIRS.dist, 'data', 'site.json'), 'utf8'));
  const contentDir = path.join(DIRS.dist, 'content');

  let pages = 0;
  let redirects = 0;

  for (const [routePath, entry] of Object.entries(routes)) {
    if (isRedirect(entry)) {
      write(outPathFor(routePath), buildRedirectPage(routePath, entry.redirect));
      redirects++;
      continue;
    }
    const contentFile = path.join(contentDir, entry.file);
    if (!fs.existsSync(contentFile)) {
      throw new Error(`[prerender] content missing for "${routePath}": ${entry.file}`);
    }
    const content = fs.readFileSync(contentFile, 'utf8');
    const html = await minify(buildPage(shell, routePath, entry, content, site), MINIFY_OPTS);
    write(outPathFor(routePath), html);
    pages++;
  }

  // ─── The static search page ───────────────────────────────────────────────
  const searchMeta: RouteMeta = {
    file: '',
    title: `Search | ${SITE_NAME}`,
    description: 'Search TARA Personal Transportation Vehicles — models, accessories, support and news.',
    image: '/images/og-image.png',
    imageAlt: 'TARA PTV icon',
    bodyClass: '',
  };
  write(
    outPathFor('/search/'),
    await minify(buildPage(shell, '/search/', searchMeta, '', site), MINIFY_OPTS),
  );
  pages++;

  // ─── SPA fallback for deep links GitHub Pages cannot resolve ──────────────
  const notFound = await minify(
    buildHead(shell, '/404/', {
      file: '',
      title: `Page not found | ${SITE_NAME}`,
      description: 'The page you were looking for is not here.',
      image: '/images/og-image.png',
      imageAlt: 'TARA PTV icon',
      bodyClass: '',
    }).replace(/<meta\s+name="robots"[^>]*>/i, '<meta name="robots" content="noindex,follow" />'),
    MINIFY_OPTS,
  );
  write(path.join(DIRS.dist, '404.html'), notFound);

  // ─── Files GitHub Pages needs ─────────────────────────────────────────────
  // Without .nojekyll, Pages runs Jekyll and drops every _-prefixed path.
  fs.writeFileSync(path.join(DIRS.dist, '.nojekyll'), '');

  // Pages wipes the CNAME on every deploy, so the build has to re-emit it.
  const cnameSrc = path.join(DIRS.root, 'CNAME');
  if (IS_CUSTOM_DOMAIN) {
    const domain = fs.existsSync(cnameSrc) ? fs.readFileSync(cnameSrc, 'utf8').trim() : SITE_DOMAIN;
    fs.writeFileSync(path.join(DIRS.dist, 'CNAME'), `${domain}\n`);
    console.log(`[prerender] wrote CNAME → ${domain}`);
  } else {
    console.log(`[prerender] BASE_PATH="${BASE_PATH}" — project site, no CNAME written.`);
  }

  console.log(
    `[prerender] wrote ${pages} page(s) + ${redirects} redirect stub(s), 404.html and .nojekyll → dist/`,
  );
}

main().catch((err) => {
  console.error('[prerender] fatal:', err);
  process.exit(1);
});
