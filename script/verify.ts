/**
 * verify.ts — gate between `npm run build` and a deploy.
 *
 * Fails loudly if the artifact is not something GitHub Pages can serve:
 *   • required files present (index.html, 404.html, .nojekyll, snapshot JSON,
 *     sitemap.xml, prerendered route directories)
 *   • per-file and total size limits (Pages hard-caps a file at 100 MB)
 *   • no same-origin API call, localhost reference or secret name in the
 *     built bundle
 *   • images really are being served as WebP/AVIF with a srcset
 *   • the home page, a deep link and a dynamic detail page all render, over
 *     the same static server `npm run preview` uses
 */
import fs from 'node:fs';
import path from 'node:path';

import { BASE_PREFIX, DIRS, SITE_DOMAIN } from './lib/config.js';
import { createServer } from './serve-dist.js';

const HARD_FILE_LIMIT = 100 * 1024 * 1024; // GitHub Pages rejects anything larger
const WARN_FILE_LIMIT = 25 * 1024 * 1024;
const FLAG_FILE_LIMIT = 1 * 1024 * 1024;
const TOTAL_LIMIT = 500 * 1024 * 1024;

const failures: string[] = [];
const warnings: string[] = [];

function fail(msg: string) {
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
}
function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function warn(msg: string) {
  warnings.push(msg);
  console.warn(`  ! ${msg}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

async function main() {
  console.log(`\nVerifying ${DIRS.dist}\n`);

  if (!fs.existsSync(DIRS.dist)) {
    console.error('dist/ does not exist — run `npm run build` first.');
    process.exit(1);
  }

  // ── 1. Required files ─────────────────────────────────────────────────────
  console.log('1. Required files');
  const required = [
    'index.html',
    '404.html',
    '.nojekyll',
    'sitemap.xml',
    'robots.txt',
    'data/routes.json',
    'data/site.json',
    'data/search-index.json',
    'data/products.json',
    'data/news.json',
  ];
  for (const rel of required) {
    const p = path.join(DIRS.dist, rel);
    if (fs.existsSync(p)) ok(`${rel} (${kb(fs.statSync(p).size)})`);
    else fail(`missing ${rel}`);
  }

  const routes = JSON.parse(fs.readFileSync(path.join(DIRS.dist, 'data', 'routes.json'), 'utf8')) as Record<
    string,
    { redirect?: string }
  >;
  const routePaths = Object.keys(routes).filter((p) => !routes[p].redirect);
  const missingDirs = routePaths.filter(
    (p) => p !== '/' && !fs.existsSync(path.join(DIRS.dist, p.replace(/^\/|\/$/g, ''), 'index.html')),
  );
  if (missingDirs.length === 0) ok(`${routePaths.length} prerendered route director${routePaths.length === 1 ? 'y' : 'ies'}`);
  else fail(`${missingDirs.length} route(s) were not prerendered, e.g. ${missingDirs.slice(0, 3).join(', ')}`);

  // ── 2. Sizes ──────────────────────────────────────────────────────────────
  console.log('\n2. Size budget');
  const files = walk(DIRS.dist).map((p) => ({ p, rel: path.relative(DIRS.dist, p), size: fs.statSync(p).size }));
  const total = files.reduce((n, f) => n + f.size, 0);
  console.log(`  total dist/: ${mb(total)} across ${files.length} files`);

  const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 20);
  console.log('\n  20 largest files:');
  for (const [i, f] of largest.entries()) {
    console.log(`   ${String(i + 1).padStart(2)}. ${mb(f.size).padStart(9)}  ${f.rel}`);
  }

  const over100 = files.filter((f) => f.size > HARD_FILE_LIMIT);
  const over25 = files.filter((f) => f.size > WARN_FILE_LIMIT);
  const over1 = files.filter((f) => f.size > FLAG_FILE_LIMIT);
  console.log('');
  if (over100.length) fail(`${over100.length} file(s) exceed the 100 MB GitHub Pages hard cap`);
  if (over25.length) fail(`${over25.length} file(s) exceed 25 MB: ${over25.map((f) => f.rel).join(', ')}`);
  else ok('no file over 25 MB');
  if (total > TOTAL_LIMIT) fail(`dist/ is ${mb(total)} — over the 500 MB budget`);
  else ok(`dist/ total ${mb(total)} is within the 500 MB budget`);
  if (over1.length) {
    warn(`${over1.length} file(s) over 1 MB:`);
    for (const f of over1.slice(0, 15)) console.warn(`      ${mb(f.size)}  ${f.rel}`);
  } else ok('no file over 1 MB');

  // ── 3. Bundle hygiene ─────────────────────────────────────────────────────
  console.log('\n3. Bundle hygiene (localhost / same-origin API / secrets)');
  const textFiles = files.filter((f) => /\.(html|js|css|json|xml|txt)$/i.test(f.rel));
  const secretNames = ['INVENTORY_API_KEY', 'GITHUB_TOKEN', 'GMAIL_', 'DATABASE_URL', 'SESSION_SECRET'];
  const patterns: Array<[string, RegExp]> = [
    ['localhost', /localhost(?::\d+)?/i],
    ['127.0.0.1', /127\.0\.0\.1/],
    ['same-origin /api/ call', /(?:fetch|axios|url)\s*\(\s*["'`]\/api\//i],
    ['/api/ path literal', /["'`]\/api\/[a-z0-9_-]/i],
    ...secretNames.map((n) => [`secret name ${n}`, new RegExp(n)] as [string, RegExp]),
  ];
  const hits = new Map<string, string[]>();
  for (const f of textFiles) {
    const text = fs.readFileSync(f.p, 'utf8');
    for (const [label, re] of patterns) {
      if (re.test(text)) hits.set(label, [...(hits.get(label) ?? []), f.rel]);
    }
  }
  if (hits.size === 0) ok('no localhost, same-origin /api/ call or secret name found');
  for (const [label, where] of hits) {
    fail(`${label} found in ${where.length} file(s): ${where.slice(0, 5).join(', ')}`);
  }

  const envLeak = files.filter((f) => /(^|\/)\.env/.test(f.rel));
  if (envLeak.length) fail(`.env file shipped: ${envLeak.map((f) => f.rel).join(', ')}`);
  else ok('no .env file in dist/');

  // ── 3b. Client-requested removals ────────────────────────────────────────
  console.log('\n3b. Client-requested removals (must never reappear)');
  const forbidden: Array<[string, RegExp]> = [
    ['Mautic inquiry form', /mauticform/i],
    ['external form script', /formcs\.globalso\.com/i],
    ['inquiry-form-wrap section', /class="inquiry-form-wrap"/i],
    ['floating contact sidebar', /class="right_nav"/i],
    ['inquiry popup', /class="inquiry-pop-bd"/i],
    ['WhatsApp widget', /id="whatsappMain"|id="whatsapp"/i],
    ['legacy web-footer', /<footer class="web-footer"/i],
  ];
  const htmlFiles = files.filter((f) => f.rel.endsWith('.html'));
  for (const [label, re] of forbidden) {
    const where = htmlFiles.filter((f) => re.test(fs.readFileSync(f.p, 'utf8')));
    if (where.length) {
      fail(`${label} present in ${where.length} page(s): ${where.slice(0, 3).map((f) => f.rel).join(', ')}`);
    }
  }
  ok(`checked ${htmlFiles.length} HTML file(s) for removed markup`);

  // ── 3c. Contact details ──────────────────────────────────────────────────
  console.log('\n3c. Contact details');
  const legacyContacts: Array<[string, RegExp]> = [
    ['legacy email address', /[A-Za-z0-9._%+-]+@(?:taraptv|taragolfcart|tara-ev)\.com/i],
    // A real tel: link is followed by a digit or +. The bare-word guard keeps
    // minified identifiers like `nextel:` and `hotel:` from matching.
    ['stale tel: link', /(?<![A-Za-z])tel:(?!\+18448443432)[+0-9(]/i],
  ];
  for (const [label, re] of legacyContacts) {
    const where = textFiles.filter((f) => re.test(fs.readFileSync(f.p, 'utf8')));
    if (where.length) fail(`${label} in ${where.length} file(s): ${where.slice(0, 3).map((f) => f.rel).join(', ')}`);
    else ok(`no ${label}`);
  }

  // ── 4. Images ─────────────────────────────────────────────────────────────
  console.log('\n4. Image delivery');
  const imageFiles = files.filter((f) => f.rel.startsWith('images/'));
  const byExt = new Map<string, { n: number; bytes: number }>();
  for (const f of imageFiles) {
    const ext = path.extname(f.rel).toLowerCase() || '(none)';
    const cur = byExt.get(ext) ?? { n: 0, bytes: 0 };
    byExt.set(ext, { n: cur.n + 1, bytes: cur.bytes + f.size });
  }
  for (const [ext, v] of [...byExt].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`  ${ext.padEnd(6)} ${String(v.n).padStart(5)} files  ${mb(v.bytes)}`);
  }
  const modern = (byExt.get('.webp')?.n ?? 0) + (byExt.get('.avif')?.n ?? 0);
  if (modern > 0 && modern / imageFiles.length > 0.8) ok(`${modern}/${imageFiles.length} shipped images are WebP/AVIF`);
  else fail(`only ${modern}/${imageFiles.length} shipped images are WebP/AVIF`);

  const home = fs.readFileSync(path.join(DIRS.dist, 'index.html'), 'utf8');
  const srcsetCount = (home.match(/srcset=/g) ?? []).length;
  const webpSrc = (home.match(/\.webp/g) ?? []).length;
  if (srcsetCount > 0) ok(`home page emits ${srcsetCount} srcset attribute(s)`);
  else fail('home page has no srcset attributes');
  if (webpSrc > 0) ok(`home page references ${webpSrc} WebP asset(s)`);
  else fail('home page references no WebP assets');
  const imgTags = home.match(/<img\b[^>]*>/g) ?? [];
  const missingDims = imgTags.filter((t) => !/\bwidth=/.test(t) || !/\bheight=/.test(t));
  if (missingDims.length === 0) ok(`all ${imgTags.length} <img> on the home page carry width/height`);
  else warn(`${missingDims.length}/${imgTags.length} <img> on the home page lack width/height`);
  const missingLazy = imgTags.filter((t) => !/\bloading=/.test(t));
  if (missingLazy.length === 0) ok(`all ${imgTags.length} <img> on the home page set loading=`);
  else warn(`${missingLazy.length}/${imgTags.length} <img> on the home page lack loading=`);

  // ── 5. Serve it ───────────────────────────────────────────────────────────
  console.log('\n5. Static serve check');
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;

  const detailPage = routePaths.find((p) => p.includes('-product/')) ?? routePaths[1];
  const deepLink = routePaths.find((p) => p.startsWith('/news/')) ?? routePaths[2];
  const checks: Array<[string, string]> = [
    ['home page', '/'],
    ['deep link', deepLink],
    ['dynamic detail page', detailPage],
    ['search page', '/search/'],
    ['snapshot JSON', '/data/routes.json'],
    ['sitemap', '/sitemap.xml'],
  ];

  for (const [label, urlPath] of checks) {
    const res = await fetch(`${origin}${BASE_PREFIX}${urlPath}`);
    const body = await res.text();
    if (!res.ok) {
      fail(`${label} ${urlPath} → HTTP ${res.status}`);
      continue;
    }
    if (urlPath.endsWith('.json') || urlPath.endsWith('.xml')) {
      ok(`${label} ${urlPath} → 200 (${kb(body.length)})`);
      continue;
    }
    const prerendered = /id="page" data-prerendered="1"/.test(body) || urlPath === '/search/';
    const hasTitle = /<title>[^<]{5,}<\/title>/.test(body);
    if (prerendered && hasTitle) ok(`${label} ${urlPath} → 200, prerendered, titled`);
    else fail(`${label} ${urlPath} → 200 but prerendered=${prerendered} title=${hasTitle}`);
  }

  const missing = await fetch(`${origin}${BASE_PREFIX}/definitely-not-a-page/`);
  if (missing.status === 404) ok('unknown URL → 404.html with a 404 status');
  else fail(`unknown URL returned HTTP ${missing.status}`);

  // Every asset the home page references must actually resolve.
  const assetUrls = [...home.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => u.startsWith('/') && !u.startsWith('//'))
    .slice(0, 120);
  let broken = 0;
  for (const u of new Set(assetUrls)) {
    const res = await fetch(`${origin}${u}`, { method: 'GET' });
    if (!res.ok) {
      broken++;
      if (broken <= 5) console.error(`      broken: ${u} → ${res.status}`);
    }
  }
  if (broken === 0) ok(`all ${new Set(assetUrls).size} home-page asset URLs resolve`);
  else fail(`${broken} home-page asset URL(s) do not resolve`);

  server.close();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Site: https://${SITE_DOMAIN}${BASE_PREFIX}/   base path: "${BASE_PREFIX || '/'}"`);
  console.log(`dist/: ${mb(total)}, ${files.length} files, ${routePaths.length + 1} prerendered pages`);
  if (warnings.length) console.log(`${warnings.length} warning(s)`);
  if (failures.length) {
    console.error(`\n${failures.length} CHECK(S) FAILED:`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log('\nAll checks passed.\n');
}

main().catch((err) => {
  console.error('[verify] fatal:', err);
  process.exit(1);
});
