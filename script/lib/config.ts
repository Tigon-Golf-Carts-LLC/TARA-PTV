/**
 * Single source of truth for build-time configuration.
 *
 * Everything here is resolved once, at BUILD time, from environment
 * variables. Nothing in this file is shipped to the browser except the
 * handful of values that are deliberately baked into the snapshot JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Directories. `static/`, `content-src/` and `assets-src/` are SOURCES
 *  (committed). `public/` and `dist/` are generated build output. */
export const DIRS = {
  root: ROOT,
  staticSrc: path.join(ROOT, 'static'),
  contentSrc: path.join(ROOT, 'content-src'),
  assetsSrc: path.join(ROOT, 'assets-src', 'images'),
  public: path.join(ROOT, 'public'),
  publicData: path.join(ROOT, 'public', 'data'),
  publicContent: path.join(ROOT, 'public', 'content'),
  publicImages: path.join(ROOT, 'public', 'images'),
  dist: path.join(ROOT, 'dist'),
  cache: path.join(ROOT, '.cache', 'images'),
};

/** Base path the site is served from.
 *  "/" for a custom domain or <user>.github.io
 *  "/<repo-name>/" for a project site. */
export const BASE_PATH = (() => {
  let b = process.env.BASE_PATH || '/';
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b += '/';
  return b;
})();

/** BASE_PATH without the trailing slash — "" when serving from the root. */
export const BASE_PREFIX = BASE_PATH === '/' ? '' : BASE_PATH.replace(/\/$/, '');

/** Bare domain (no scheme, no trailing slash) used for canonical URLs,
 *  sitemap.xml and the CNAME file. */
export const SITE_DOMAIN = (process.env.SITE_DOMAIN || 'taraptv.com')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

export const SITE_ORIGIN = `https://${SITE_DOMAIN}`;

/** Absolute public URL for a root-relative site path. */
export function absoluteUrl(p: string): string {
  if (/^https?:\/\//.test(p)) return p;
  return SITE_ORIGIN + BASE_PREFIX + (p.startsWith('/') ? p : '/' + p);
}

/** Prefix a root-absolute site path with the configured base path. */
export function withBase(p: string): string {
  if (!p.startsWith('/') || p.startsWith('//')) return p;
  return BASE_PREFIX + p;
}

/** True when the site is deployed on a custom domain (needs a CNAME file). */
export const IS_CUSTOM_DOMAIN =
  BASE_PATH === '/' && !/\.github\.io$/i.test(SITE_DOMAIN);

/**
 * Dealership contact details. These are the ONLY email address and phone
 * number that may appear anywhere on the site — every legacy address found
 * in the content mirror is rewritten to these at build time.
 */
export const CONTACT = {
  email: process.env.CONTACT_EMAIL || 'taradealership@gmail.com',
  phoneDisplay: process.env.CONTACT_PHONE || '1-844-844-3432',
  phoneHref: 'tel:+18448443432',
  phoneE164: '+18448443432',
};

/**
 * Third-party form endpoint used in place of the deleted Express inquiry
 * route. Set FORMSPREE_ENDPOINT in the build environment to enable AJAX
 * submission; without it the form degrades to a prefilled mailto: link.
 */
export const FORM_ENDPOINT = process.env.FORMSPREE_ENDPOINT || '';

export const SITE_NAME = 'TARA Personal Transportation Vehicles';

/**
 * `public/` is regenerated in stages and the image rewrite is NOT idempotent:
 * once the page mirror points at derivative URLs, re-running the optimiser
 * would look for sources that never existed. This marker makes the ordering
 * mistake fail loudly instead of silently producing a broken tree.
 */
export const STAGE_FILE = path.join(DIRS.public, '.build-stage');

export function setStage(stage: 'staged' | 'optimized') {
  fs.mkdirSync(DIRS.public, { recursive: true });
  fs.writeFileSync(STAGE_FILE, stage, 'utf8');
}

export function readStage(): string | null {
  return fs.existsSync(STAGE_FILE) ? fs.readFileSync(STAGE_FILE, 'utf8').trim() : null;
}

export function logConfig(scriptName: string) {
  console.log(
    `[${scriptName}] BASE_PATH=${BASE_PATH} SITE_DOMAIN=${SITE_DOMAIN} ` +
      `customDomain=${IS_CUSTOM_DOMAIN} form=${FORM_ENDPOINT ? 'formspree' : 'mailto'}`,
  );
}
