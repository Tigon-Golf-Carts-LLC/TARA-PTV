/**
 * optimize-assets.ts — build-time image pipeline.
 *
 * Source images live in `assets-src/images/` and are NEVER shipped. This
 * script emits optimised derivatives into `public/images/` (which Vite then
 * copies into `dist/`), and rewrites every <img> in the page mirror to point
 * at them with a responsive srcset, intrinsic dimensions and lazy loading.
 *
 * What it does:
 *   • converts photos to WebP (quality 78) — and AVIF when ENABLE_AVIF=1
 *   • emits responsive widths 400/800/1200/1600 plus a base capped at 2000px
 *   • downscales oversized sources (nothing is emitted above MAX_WIDTH)
 *   • strips all EXIF/ICC metadata (sharp drops it unless asked to keep it)
 *   • runs SVGs through SVGO and losslessly crushes PNGs that must stay PNG
 *   • skips images nothing references, so orphans never reach dist/
 *
 * Encoding is cached in `.cache/images/` keyed on the source content hash, so
 * a rebuild only re-encodes what actually changed (see the CI cache step in
 * .github/workflows/deploy.yml).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { optimize as svgoOptimize } from 'svgo';
import { transformWithEsbuild } from 'vite';

import { BASE_PREFIX, DIRS, logConfig, readStage, setStage } from './lib/config.js';

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Nothing on a web page needs to be wider than this. */
const MAX_WIDTH = 1600;
const RESPONSIVE_WIDTHS = [400, 800, 1200];
const WEBP_QUALITY = 76;
const AVIF_QUALITY = 50;
/** Below this intrinsic width an image gets a single derivative, no srcset. */
const SRCSET_MIN_WIDTH = 480;
/**
 * AVIF is opt-in: serving it requires wrapping each <img> in a <picture>, and
 * the mirrored stylesheet contains direct-child rules (`a>img`,
 * `.swiper-zoom-container>img`) that such a wrapper would break. Set
 * ENABLE_AVIF=1 to emit AVIF and wrap the images anyway.
 */
const ENABLE_AVIF = process.env.ENABLE_AVIF === '1';
const CONCURRENCY = Math.max(2, os.cpus().length);
/** Bump when the encoder settings change, to invalidate every cache entry. */
const PIPELINE_VERSION = 'v4';

/** Files kept in their original format at their original URL: index.html and
 *  the web-app manifest reference them by name and browsers still want PNG. */
const PASSTHROUGH = new Set(['favicon.png', 'apple-touch-icon.png', 'og-image.png']);
/** Social scrapers are unreliable with WebP, so every image used as an
 *  og:image also gets a capped JPEG alongside the WebP set. */
const OG_WIDTH = 1200;
const OG_QUALITY = 75;

sharp.concurrency(1);
sharp.cache(false);

// ─── Types ───────────────────────────────────────────────────────────────────

type Derivative = { url: string; width: number; format: 'webp' | 'avif' };
type Entry = {
  /** Source path relative to assets-src/images, e.g. "ext/foo.png" */
  rel: string;
  width: number;
  height: number;
  /** Base (largest) WebP derivative — what the src attribute points at. */
  base: Derivative;
  webp: Derivative[];
  avif: Derivative[];
  /** Original-format copy kept for social scrapers (OG/Twitter images). */
  og?: Derivative;
  /** Original-format copy kept at its original URL (favicons, app icons). */
  passthrough?: string;
  srcBytes: number;
  outBytes: number;
};

type Manifest = Record<string, { hash: string; files: string[]; meta: Omit<Entry, 'rel'> }>;

// ─── Reference collection ────────────────────────────────────────────────────

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matches an image URL with or without the deployed base prefix. The prefix
 * has to be part of the match: by the time this runs, fetch-data.ts has
 * already rewritten the mirror to "/<base>/images/…", and matching only the
 * "/images/…" tail would prepend the base a second time.
 */
const IMG_URL_RE = new RegExp(
  `(?:${escapeRe(BASE_PREFIX)})?/images/[^"'()<>\\s\\\\]+?\\.(?:png|jpe?g|webp|gif|svg)`,
  'gi',
);

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Every `/images/...` URL that appears anywhere in the generated site. */
function collectReferences(): Set<string> {
  const refs = new Set<string>();
  const scanDirs = [DIRS.publicContent, DIRS.publicData, path.join(DIRS.public, 'css'), path.join(DIRS.root, 'src')];
  const files = scanDirs.flatMap((d) => walk(d));
  files.push(path.join(DIRS.root, 'index.html'));
  for (const f of walk(DIRS.public).filter((p) => /\.(xml|json|txt)$/i.test(p) && !p.includes(`${path.sep}data${path.sep}`))) {
    files.push(f);
  }

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    if (!/\.(html?|css|json|xml|txt|tsx?|jsx?)$/i.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(IMG_URL_RE)) {
      refs.add(normalizeRef(m[0]));
    }
  }

  // The shell references these through Vite's %BASE_URL% placeholder rather
  // than a literal /images/ path, so add them unconditionally.
  for (const name of PASSTHROUGH) refs.add(name);

  return refs;
}

/** "/base/images/a%20b.png" → "a b.png" (relative to assets-src/images). */
function normalizeRef(url: string): string {
  let u = url;
  if (BASE_PREFIX && u.startsWith(BASE_PREFIX)) u = u.slice(BASE_PREFIX.length);
  u = u.replace(/^\/images\//, '');
  try {
    u = decodeURIComponent(u);
  } catch {
    /* leave malformed escapes alone */
  }
  return u;
}

/** Derivative file name: "foo.jpg" → "foo_jpg" (never collides with a twin
 *  "foo.webp", of which this mirror has 519 pairs). This same mapping names
 *  the compressed masters in assets-src — see script/compress-sources.ts. */
function stemFor(rel: string): string {
  const dir = path.dirname(rel);
  const base = path.basename(rel);
  const ext = path.extname(base).slice(1).toLowerCase();
  const stem = `${base.slice(0, base.length - ext.length - 1)}_${ext}`;
  return dir === '.' ? stem : `${dir}/${stem}`;
}

// ─── Encoding ────────────────────────────────────────────────────────────────

function hashFile(p: string, flags: string): string {
  return crypto
    .createHash('sha1')
    .update(fs.readFileSync(p))
    .update(PIPELINE_VERSION)
    .update(String(MAX_WIDTH))
    .update(String(WEBP_QUALITY))
    .update(ENABLE_AVIF ? 'avif' : 'noavif')
    .update(flags)
    .digest('hex');
}

const cacheOut = path.join(DIRS.cache, 'out');

async function encodeOne(rel: string, srcAbs: string, wantOg: boolean): Promise<Entry | null> {
  const stem = stemFor(rel);
  const image = sharp(srcAbs, { animated: true, failOn: 'none' });
  const md = await image.metadata();
  const srcWidth = md.width ?? 0;
  const srcHeight = md.height ?? 0;
  if (!srcWidth || !srcHeight) return null;

  // Animated GIF/WebP: one animated WebP, no responsive set (resizing an
  // animation multiplies the encode cost for no real benefit).
  const animated = (md.pages ?? 1) > 1;

  const baseWidth = Math.min(srcWidth, MAX_WIDTH);
  const targetWidths = animated
    ? [baseWidth]
    : Array.from(
        new Set(
          srcWidth < SRCSET_MIN_WIDTH
            ? [baseWidth]
            : [...RESPONSIVE_WIDTHS.filter((w) => w < baseWidth), baseWidth],
        ),
      ).sort((a, b) => a - b);

  const files: string[] = [];
  const webp: Derivative[] = [];
  const avif: Derivative[] = [];
  let outBytes = 0;

  const emit = async (w: number, format: 'webp' | 'avif') => {
    const isBase = w === baseWidth;
    const name = isBase ? `${stem}.${format}` : `${stem}-${w}.${format}`;
    const dest = path.join(cacheOut, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    // No .withMetadata() call ⇒ sharp strips EXIF/ICC/XMP entirely.
    let pipe = sharp(srcAbs, { animated, failOn: 'none' }).resize({
      width: w,
      withoutEnlargement: true,
      fit: 'inside',
    });
    pipe =
      format === 'webp'
        ? pipe.webp({ quality: WEBP_QUALITY, effort: 5, alphaQuality: 90 })
        : pipe.avif({ quality: AVIF_QUALITY, effort: 3 });

    const info = await pipe.toFile(dest);
    files.push(name);
    outBytes += fs.statSync(dest).size;
    const d: Derivative = { url: `/images/${encodeURI(name)}`, width: info.width, format };
    (format === 'webp' ? webp : avif).push(d);
  };

  for (const w of targetWidths) await emit(w, 'webp');
  if (ENABLE_AVIF && !animated) for (const w of targetWidths) await emit(w, 'avif');

  // Social-scraper fallback in the original raster family (JPEG).
  let og: Derivative | undefined;
  if (wantOg && !animated) {
    const name = `${stem}-og.jpg`;
    const dest = path.join(cacheOut, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const info = await sharp(srcAbs, { failOn: 'none' })
      .resize({ width: Math.min(srcWidth, OG_WIDTH), withoutEnlargement: true, fit: 'inside' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: OG_QUALITY, mozjpeg: true })
      .toFile(dest);
    files.push(name);
    outBytes += fs.statSync(dest).size;
    og = { url: `/images/${encodeURI(name)}`, width: info.width, format: 'webp' };
  }

  // Icons keep their original name and format, losslessly crushed.
  let passthrough: string | undefined;
  if (PASSTHROUGH.has(rel)) {
    const dest = path.join(cacheOut, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await sharp(srcAbs, { failOn: 'none' }).png({ compressionLevel: 9, effort: 10 }).toFile(dest);
    files.push(rel);
    outBytes += fs.statSync(dest).size;
    passthrough = `/images/${encodeURI(rel)}`;
  }

  const base = webp.find((d) => d.width === Math.min(baseWidth, srcWidth)) ?? webp[webp.length - 1];
  const scale = base.width / srcWidth;

  return {
    rel,
    width: base.width,
    height: Math.round(srcHeight * scale),
    base,
    webp: webp.sort((a, b) => a.width - b.width),
    avif: avif.sort((a, b) => a.width - b.width),
    og,
    passthrough,
    srcBytes: fs.statSync(srcAbs).size,
    outBytes,
  };
}

/** SVGs are not raster — run them through SVGO and copy them straight out. */
function optimizeSvg(rel: string, srcAbs: string): Entry {
  const name = stemFor(rel) + '.svg';
  const dest = path.join(cacheOut, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const raw = fs.readFileSync(srcAbs, 'utf8');
  const res = svgoOptimize(raw, {
    multipass: true,
    plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }, 'removeDimensions'],
  });
  fs.writeFileSync(dest, res.data, 'utf8');
  const d: Derivative = { url: `/images/${encodeURI(name)}`, width: 0, format: 'webp' };
  return {
    rel,
    width: 0,
    height: 0,
    base: d,
    webp: [],
    avif: [],
    srcBytes: Buffer.byteLength(raw),
    outBytes: Buffer.byteLength(res.data),
  };
}

// ─── Promise pool ────────────────────────────────────────────────────────────

async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

// ─── HTML rewriting ──────────────────────────────────────────────────────────

function sizesFor(width: number): string {
  if (width <= SRCSET_MIN_WIDTH) return `${width}px`;
  const cap = Math.min(width, 1200);
  return `(max-width: 600px) 100vw, (max-width: 1200px) 60vw, ${cap}px`;
}

function srcsetFor(list: Derivative[]): string {
  return list.map((d) => `${BASE_PREFIX}${d.url} ${d.width}w`).join(', ');
}

const IMG_TAG_RE = /<img\b((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/gi;

/** Read one attribute out of a raw attribute string. */
function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\s${name}=(["'])([\\s\\S]*?)\\1`, 'i'));
  return m ? m[2] : null;
}

function setAttr(attrs: string, name: string, value: string): string {
  const re = new RegExp(`\\s${name}=(["'])[\\s\\S]*?\\1`, 'i');
  const replacement = ` ${name}="${value.replace(/"/g, '&quot;')}"`;
  return re.test(attrs) ? attrs.replace(re, replacement) : attrs + replacement;
}

function rewriteHtml(html: string, entries: Map<string, Entry>, stats: { rewritten: number; missed: Set<string> }): string {
  return html.replace(IMG_TAG_RE, (whole, attrs: string) => {
    const src = attr(attrs, 'src');
    if (!src) return whole;
    const rel = normalizeRef(src);
    const entry = entries.get(rel);
    if (!entry) {
      if (src.includes('/images/')) stats.missed.add(rel);
      return whole;
    }

    // Drop the XHTML self-closing slash: appended attributes must stay inside
    // the tag, and html-minifier rejects `<img … / loading="lazy">`.
    let a = attrs.replace(/\s*\/\s*$/, '');
    a = setAttr(a, 'src', BASE_PREFIX + entry.base.url);
    if (entry.webp.length > 1) {
      a = setAttr(a, 'srcset', srcsetFor(entry.webp));
      a = setAttr(a, 'sizes', sizesFor(entry.width));
    } else {
      a = a.replace(/\ssrcset=(["'])[\s\S]*?\1/i, '');
    }
    if (entry.width && entry.height) {
      a = setAttr(a, 'width', String(entry.width));
      a = setAttr(a, 'height', String(entry.height));
    }
    if (!/\bloading=/i.test(a)) a += ' loading="lazy"';
    if (!/\bdecoding=/i.test(a)) a += ' decoding="async"';

    stats.rewritten++;
    const img = `<img${a}>`;

    if (ENABLE_AVIF && entry.avif.length) {
      return (
        `<picture><source type="image/avif" srcset="${srcsetFor(entry.avif)}" sizes="${sizesFor(entry.width)}">` +
        `${img}</picture>`
      );
    }
    return img;
  });
}

/** Rewrite `/images/...` URLs that appear outside <img> tags: CSS
 *  background-image, inline styles, srcset on <source>, JSON metadata.
 *  `preferOg` picks the JPEG social copy — used for the snapshot JSON, whose
 *  image field ends up in the og:image / twitter:image meta tags. */
function rewritePlainUrls(text: string, entries: Map<string, Entry>, preferOg = false): string {
  return text.replace(IMG_URL_RE, (url) => {
    const entry = entries.get(normalizeRef(url));
    if (!entry) return url;
    if (entry.passthrough) return BASE_PREFIX + entry.passthrough;
    const chosen = preferOg && entry.og ? entry.og : entry.base;
    return BASE_PREFIX + chosen.url;
  });
}


// ─── Stylesheet sprites (public/css/img/**) ──────────────────────────────────

/**
 * The cloned theme keeps its sprites next to the stylesheet and references
 * them with relative `url(img/…)`. Convert those to WebP in place and patch
 * the CSS, and run any loose SVG in public/ through SVGO.
 */
async function optimizeInlineStaticImages(): Promise<{ count: number; before: number; after: number }> {
  let count = 0;
  let before = 0;
  let after = 0;
  const rename = new Map<string, string>();

  for (const file of walk(DIRS.public)) {
    const relFromPublic = path.relative(DIRS.public, file).split(path.sep).join('/');
    // public/images is handled by the main pipeline.
    if (relFromPublic.startsWith('images/')) continue;

    if (/\.svg$/i.test(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      const res = svgoOptimize(raw, {
        multipass: true,
        plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }],
      });
      before += Buffer.byteLength(raw);
      after += Buffer.byteLength(res.data);
      fs.writeFileSync(file, res.data, 'utf8');
      count++;
      continue;
    }

    if (!/\.(png|jpe?g)$/i.test(file)) continue;
    const srcSize = fs.statSync(file).size;
    try {
      const buf = await sharp(file, { failOn: 'none' })
        .resize({ width: MAX_WIDTH, withoutEnlargement: true, fit: 'inside' })
        .webp({ quality: WEBP_QUALITY, effort: 5, alphaQuality: 90 })
        .toBuffer();
      // Only take the WebP when it is actually smaller.
      if (buf.length >= srcSize) continue;
      const outFile = file.replace(/\.(png|jpe?g)$/i, '.webp');
      fs.writeFileSync(outFile, buf);
      fs.rmSync(file);
      rename.set(path.basename(file), path.basename(outFile));
      before += srcSize;
      after += buf.length;
      count++;
    } catch {
      /* leave anything sharp cannot decode alone */
    }
  }

  if (rename.size) {
    for (const cssFile of walk(path.join(DIRS.public, 'css')).filter((p) => p.endsWith('.css'))) {
      let css = fs.readFileSync(cssFile, 'utf8');
      for (const [from, to] of rename) {
        css = css.split(from).join(to);
      }
      fs.writeFileSync(cssFile, css, 'utf8');
    }
  }
  return { count, before, after };
}


// ─── CSS / JS minification for the generated static tree ─────────────────────

/**
 * Vite minifies what it bundles, but files under `public/` are copied
 * verbatim — and this site keeps the cloned theme's 60+ stylesheets there.
 * Run them through esbuild so nothing ships unminified.
 */
async function minifyStaticText(): Promise<{ files: number; before: number; after: number }> {
  let files = 0;
  let before = 0;
  let after = 0;
  for (const file of walk(DIRS.public)) {
    const isCss = file.endsWith('.css');
    const isJs = file.endsWith('.js');
    if (!isCss && !isJs) continue;
    // Already-minified vendor bundles gain nothing and risk breaking.
    if (/\.min[._]/i.test(path.basename(file))) continue;
    const source = fs.readFileSync(file, 'utf8');
    try {
      // Use Vite's bundled esbuild so the JS API and the native binary can
      // never drift apart across versions.
      const res = await transformWithEsbuild(source, file, {
        loader: isCss ? 'css' : 'js',
        minify: true,
        legalComments: 'none',
      });
      if (res.code.length < source.length) {
        fs.writeFileSync(file, res.code, 'utf8');
        before += source.length;
        after += res.code.length;
        files++;
      }
    } catch {
      /* leave anything esbuild cannot parse untouched */
    }
  }
  return { files, before, after };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  logConfig('optimize-assets');
  const started = Date.now();

  const stage = readStage();
  if (stage !== 'staged') {
    throw new Error(
      stage === 'optimized'
        ? '[optimize-assets] public/ has already been optimised — re-run `tsx script/fetch-data.ts` first ' +
          '(the image rewrite is not idempotent).'
        : '[optimize-assets] public/ has not been staged — run `tsx script/fetch-data.ts` first.',
    );
  }

  const refs = collectReferences();
  console.log(`[optimize-assets] ${refs.size} distinct image reference(s) found in the generated site.`);

  // Every image a route advertises as its og:image also needs a JPEG copy.
  const routes = JSON.parse(
    fs.readFileSync(path.join(DIRS.publicData, 'routes.json'), 'utf8'),
  ) as Record<string, { image?: string }>;
  const ogRefs = new Set<string>();
  for (const meta of Object.values(routes)) {
    if (meta.image && meta.image.includes('/images/')) ogRefs.add(normalizeRef(meta.image));
  }

  const allSources = walk(DIRS.assetsSrc).map((p) => path.relative(DIRS.assetsSrc, p).split(path.sep).join('/'));
  const sourceSet = new Set(allSources);

  /**
   * Page HTML still refers to the original file name ("foo.png"), while the
   * compressed master on disk is "foo_png.webp". Resolve the reference to
   * whichever of the two exists, preferring an untouched original.
   */
  const resolveSource = (rel: string): string | null => {
    if (sourceSet.has(rel)) return rel;
    const stem = stemFor(rel);
    for (const candidate of [`${stem}.webp`, `${stem}.svg`]) {
      if (sourceSet.has(candidate)) return candidate;
    }
    return null;
  };

  const missing: string[] = [];
  /** reference path → source file backing it */
  const todo: Array<{ ref: string; source: string }> = [];
  const usedSources = new Set<string>();
  for (const rel of refs) {
    const source = resolveSource(rel);
    if (source) {
      todo.push({ ref: rel, source });
      usedSources.add(source);
    } else {
      missing.push(rel);
    }
  }
  todo.sort((a, b) => a.ref.localeCompare(b.ref));

  const orphans = allSources.filter((r) => !usedSources.has(r));
  const orphanBytes = orphans.reduce((n, r) => n + fs.statSync(path.join(DIRS.assetsSrc, r)).size, 0);

  // ─── Cache lookup ─────────────────────────────────────────────────────────
  fs.mkdirSync(cacheOut, { recursive: true });
  const manifestPath = path.join(DIRS.cache, 'manifest.json');
  const manifest: Manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : {};

  const entries = new Map<string, Entry>();
  const work: Array<{ rel: string; abs: string; hash: string }> = [];

  for (const { ref, source } of todo) {
    const abs = path.join(DIRS.assetsSrc, source);
    const flags = `${ogRefs.has(ref) ? 'og' : ''}${PASSTHROUGH.has(ref) ? 'pt' : ''}`;
    const hash = hashFile(abs, flags);
    const cached = manifest[ref];
    if (cached && cached.hash === hash && cached.files.every((f) => fs.existsSync(path.join(cacheOut, f)))) {
      entries.set(ref, { rel: ref, ...cached.meta });
    } else {
      work.push({ rel: ref, abs, hash });
    }
  }

  console.log(
    `[optimize-assets] ${todo.length} referenced image(s): ${entries.size} cached, ${work.length} to encode ` +
      `(${orphans.length} unreferenced source(s) skipped, ${(orphanBytes / 1e6).toFixed(1)} MB not shipped).`,
  );

  let done = 0;
  await pool(work, CONCURRENCY, async ({ rel, abs, hash }) => {
    try {
      const entry = abs.toLowerCase().endsWith('.svg')
        ? optimizeSvg(rel, abs)
        : await encodeOne(rel, abs, ogRefs.has(rel));
      if (!entry) return;
      entries.set(rel, entry);
      const files = [entry.base, ...entry.webp, ...entry.avif, ...(entry.og ? [entry.og] : [])].map((d) =>
        decodeURI(d.url.replace('/images/', '')),
      );
      if (entry.passthrough) files.push(decodeURI(entry.passthrough.replace('/images/', '')));
      const { rel: _drop, ...meta } = entry;
      manifest[rel] = { hash, files: [...new Set(files)], meta };
    } catch (err) {
      console.warn(`[optimize-assets] failed on ${rel}: ${(err as Error).message}`);
    }
    if (++done % 100 === 0 || done === work.length) {
      const pct = ((done / work.length) * 100).toFixed(0);
      console.log(`[optimize-assets]   encoded ${done}/${work.length} (${pct}%)`);
    }
  });

  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

  // ─── Copy the derivatives that this build actually needs ──────────────────
  fs.rmSync(DIRS.publicImages, { recursive: true, force: true });
  let shipped = 0;
  let shippedBytes = 0;
  for (const rel of entries.keys()) {
    for (const file of manifest[rel]?.files ?? []) {
      const from = path.join(cacheOut, file);
      if (!fs.existsSync(from)) continue;
      const to = path.join(DIRS.publicImages, file);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      shipped++;
      shippedBytes += fs.statSync(to).size;
    }
  }

  // ─── Rewrite every reference in the generated site ────────────────────────
  const stats = { rewritten: 0, missed: new Set<string>() };
  for (const file of walk(DIRS.publicContent)) {
    if (!file.endsWith('.html')) continue;
    let html = fs.readFileSync(file, 'utf8');
    html = rewriteHtml(html, entries, stats);
    html = rewritePlainUrls(html, entries);
    fs.writeFileSync(file, html, 'utf8');
  }
  for (const file of walk(DIRS.publicData)) {
    const text = fs.readFileSync(file, 'utf8');
    // routes/news/products feed the og:image tags, so those prefer the JPEG.
    // site.json carries the footer logo, which should stay WebP.
    const preferOg = path.basename(file) !== 'site.json';
    const next = rewritePlainUrls(text, entries, preferOg);
    if (next !== text) fs.writeFileSync(file, next, 'utf8');
  }
  for (const file of walk(DIRS.public).filter((p) => /\.(xml|css|txt)$/i.test(p))) {
    const text = fs.readFileSync(file, 'utf8');
    const next = rewritePlainUrls(text, entries);
    if (next !== text) fs.writeFileSync(file, next, 'utf8');
  }

  // Stylesheet sprites living next to the CSS (public/css/img/**) are
  // referenced relatively, so they are converted in place.
  const inline = await optimizeInlineStaticImages();
  const minified = await minifyStaticText();

  // ─── Report ───────────────────────────────────────────────────────────────
  const srcBytes = [...entries.values()].reduce((n, e) => n + e.srcBytes, 0);
  const pct = srcBytes ? (100 - (shippedBytes / srcBytes) * 100).toFixed(1) : '0';
  console.log(
    `[optimize-assets] ${entries.size} image(s) → ${shipped} derivative file(s); ` +
      `${(srcBytes / 1e6).toFixed(1)} MB source → ${(shippedBytes / 1e6).toFixed(1)} MB shipped (−${pct}%).`,
  );
  console.log(`[optimize-assets] rewrote ${stats.rewritten} <img> tag(s) in the page mirror.`);
  console.log(
    `[optimize-assets] stylesheet sprites: ${inline.count} converted, ` +
      `${(inline.before / 1024).toFixed(0)} KB → ${(inline.after / 1024).toFixed(0)} KB.`,
  );
  console.log(
    `[optimize-assets] minified ${minified.files} static CSS/JS file(s): ` +
      `${(minified.before / 1024).toFixed(0)} KB → ${(minified.after / 1024).toFixed(0)} KB.`,
  );
  if (missing.length) {
    console.warn(`[optimize-assets] ${missing.length} referenced image(s) have no source file:`);
    for (const m of missing.slice(0, 10)) console.warn(`  - ${m}`);
  }
  if (stats.missed.size) {
    console.warn(`[optimize-assets] ${stats.missed.size} <img> tag(s) left untouched (no matching source).`);
  }
  setStage('optimized');
  console.log(`[optimize-assets] finished in ${((Date.now() - started) / 1000).toFixed(0)}s.`);
}

main().catch((err) => {
  console.error('[optimize-assets] fatal:', err);
  process.exit(1);
});
