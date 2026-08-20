/**
 * compress-sources.ts — one-off (but re-runnable) compression of the image
 * SOURCES in assets-src/images/.
 *
 * The mirror arrived with 1.3 GB of originals — 10 MB PNG photographs, EXIF
 * intact, some 4000 px wide. Nothing on the site is served above 1600 px, so
 * the originals were pure repository weight: GitHub warns past ~1 GB of repo.
 *
 * This rewrites every source as a WebP master capped at 2000 px (headroom
 * above the 1600 px delivery cap), strips metadata, and renames it to the
 * canonical form the delivery pipeline already uses:
 *
 *   2+2-pass-golf-cart-color-sky-blue.png  →  2+2-pass-golf-cart-color-sky-blue_png.webp
 *   harmony250626.webp                     →  harmony250626_webp.webp
 *
 * Encoding the extension into the name is what makes this safe: the mirror
 * has 519 stem collisions (a "foo.jpg" and a "foo.webp" of the same photo),
 * which a plain ".webp" rename would silently merge. Page HTML still refers
 * to the ORIGINAL file name; optimize-assets.ts resolves it through the same
 * stemFor() mapping, so no content file has to change.
 *
 *   npm run compress:sources          # compress anything not yet canonical
 *   npm run compress:sources -- --dry # report what would happen
 *
 * Re-running is safe: files already in canonical form are skipped, so the
 * masters are never re-encoded and never lose another generation.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { optimize as svgoOptimize } from 'svgo';

import { DIRS } from './lib/config.js';

/** Archival master width. Delivery caps at 1600 px; this leaves headroom. */
const MASTER_WIDTH = 2000;
const MASTER_QUALITY = 82;
const CONCURRENCY = Math.max(2, os.cpus().length);

/**
 * Kept byte-for-byte: the shell and the web-app manifest reference these by
 * name and need real PNGs, and they are small enough not to matter.
 */
const KEEP_ORIGINAL = new Set(['favicon.png', 'apple-touch-icon.png', 'og-image.png']);

/** A source that has already been through this script. */
const CANONICAL_RE = /_(?:png|jpe?g|webp|gif|svg|avif|bmp|tiff?)\.(?:webp|svg)$/i;

sharp.concurrency(1);
sharp.cache(false);

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** "ext/foo.jpg" → "ext/foo_jpg" — the same mapping optimize-assets uses. */
function stemFor(rel: string): string {
  const dir = path.dirname(rel);
  const base = path.basename(rel);
  const ext = path.extname(base).slice(1).toLowerCase();
  const stem = `${base.slice(0, base.length - ext.length - 1)}_${ext}`;
  return dir === '.' ? stem : `${dir}/${stem}`;
}

async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i], i);
      }
    }),
  );
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const dry = process.argv.includes('--dry');
  const root = DIRS.assetsSrc;
  if (!fs.existsSync(root)) throw new Error(`[compress-sources] ${root} does not exist`);

  const all = walk(root).map((p) => path.relative(root, p).split(path.sep).join('/'));
  const todo = all.filter((rel) => !CANONICAL_RE.test(rel) && !KEEP_ORIGINAL.has(rel));
  const skipped = all.length - todo.length;

  const before = all.reduce((n, rel) => n + fs.statSync(path.join(root, rel)).size, 0);
  console.log(
    `[compress-sources] ${all.length} source(s), ${mb(before)}; ` +
      `${todo.length} to compress, ${skipped} already canonical or kept as-is.` +
      (dry ? ' (dry run)' : ''),
  );

  let done = 0;
  let saved = 0;
  let written = 0;
  const failures: string[] = [];

  await pool(todo, CONCURRENCY, async (rel) => {
    const src = path.join(root, rel);
    const srcSize = fs.statSync(src).size;
    const isSvg = rel.toLowerCase().endsWith('.svg');
    const outRel = stemFor(rel) + (isSvg ? '.svg' : '.webp');
    const out = path.join(root, outRel);

    try {
      let outSize: number;
      if (isSvg) {
        const raw = fs.readFileSync(src, 'utf8');
        const res = svgoOptimize(raw, {
          multipass: true,
          plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }],
        });
        outSize = Buffer.byteLength(res.data);
        if (!dry) {
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, res.data, 'utf8');
        }
      } else {
        const meta = await sharp(src, { animated: true, failOn: 'none' }).metadata();
        const animated = (meta.pages ?? 1) > 1;
        // No .withMetadata() ⇒ sharp drops EXIF/ICC/XMP.
        const buf = await sharp(src, { animated, failOn: 'none' })
          .resize({ width: MASTER_WIDTH, withoutEnlargement: true, fit: 'inside' })
          .webp({ quality: MASTER_QUALITY, effort: 5, alphaQuality: 92 })
          .toBuffer();
        outSize = buf.length;
        if (!dry) {
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, buf);
        }
      }

      if (!dry && out !== src) fs.rmSync(src);
      saved += srcSize - outSize;
      written += outSize;
    } catch (err) {
      failures.push(`${rel}: ${(err as Error).message}`);
    }

    if (++done % 200 === 0 || done === todo.length) {
      console.log(`[compress-sources]   ${done}/${todo.length} (${((done / todo.length) * 100).toFixed(0)}%)`);
    }
  });

  const after = dry
    ? before - saved
    : walk(root).reduce((n, p) => n + fs.statSync(p).size, 0);

  console.log(
    `[compress-sources] ${mb(before)} → ${mb(after)} ` +
      `(−${(100 - (after / before) * 100).toFixed(1)}%, ${mb(saved)} saved; ${mb(written)} of new masters).`,
  );
  if (failures.length) {
    console.warn(`[compress-sources] ${failures.length} file(s) failed and were left untouched:`);
    for (const f of failures.slice(0, 10)) console.warn(`  - ${f}`);
  }
}

main().catch((err) => {
  console.error('[compress-sources] fatal:', err);
  process.exit(1);
});
